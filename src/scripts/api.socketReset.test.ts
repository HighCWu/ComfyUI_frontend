import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi
} from 'vitest'
import { fromPartial } from '@total-typescript/shoehorn'
import type {
  WebSessionRequestScope,
  WebSessionRequests
} from '@/platform/auth/session/webSessionFetch'
import { provideWebSessionRequests } from '@/platform/auth/session/webSessionFetch'

import { installCloudApiAuth } from '@/platform/auth/cloudApiAuthProvider'
import { api } from '@/scripts/api'
import { useAuthStore } from '@/stores/authStore'

vi.mock(import('firebase/auth'))

let currentToken: string | undefined = 'token-a'
// When set, each getAuthToken() call parks until released, capturing the token
// value that was active at call time — models a deferred/async token fetch.
let deferTokenFetch = false
let pendingTokenReleases: (() => void)[] = []

const releaseNextToken = async () => {
  const release = pendingTokenReleases.shift()
  release?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

vi.mock(import('@/platform/distribution/types'), () => ({ isCloud: true }))

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.CONNECTING
  binaryType = ''
  send = vi.fn()
  removeEventListener = vi.fn()
  handlers: Record<string, (event: unknown) => void> = {}
  addEventListener = vi.fn(
    (event: string, handler: (event: unknown) => void) => {
      this.handlers[event] = handler
    }
  )
  close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED
    this.handlers['close']?.(new Event('close'))
  })

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  simulateOpen() {
    this.readyState = FakeWebSocket.OPEN
    this.handlers['open']?.(new Event('open'))
  }

  simulateError() {
    this.handlers['error']?.(new Event('error'))
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('ComfyApi realtime socket reset', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    currentToken = 'token-a'
    deferTokenFetch = false
    pendingTokenReleases = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    api.socket = null
    installCloudApiAuth()
    vi.mocked(useAuthStore().getAuthToken).mockImplementation(() => {
      if (!deferTokenFetch) return Promise.resolve(currentToken)
      const captured = currentToken
      return new Promise<string | undefined>((resolve) => {
        pendingTokenReleases.push(() => resolve(captured))
      })
    })
  })

  afterEach(() => {
    api.socket = null
  })

  function scopedSession(scope?: string): WebSessionRequestScope {
    return {
      epoch: 1,
      session: {
        user: {
          id: 'same-user',
          email: 'same@example.test',
          emailVerified: true
        },
        csrfToken: 'csrf',
        expiresAt: Date.now() + 60_000,
        absoluteExpiresAt: Date.now() + 120_000,
        socketScope: scope
      }
    }
  }

  function socketSession(
    read: () => Promise<WebSessionRequestScope | undefined>,
    refreshScope?: WebSessionRequests['refreshScope']
  ) {
    const previousName = window.name
    const previousScope = sessionStorage.getItem('comfy:socket-scope')
    const previousId = sessionStorage.getItem('clientId')
    const release = provideWebSessionRequests(
      fromPartial<WebSessionRequests>({
        scope: read,
        send: fetch,
        refreshScope
      })
    )
    onTestFinished(() => {
      release()
      window.name = previousName
      if (previousScope === null)
        sessionStorage.removeItem('comfy:socket-scope')
      else sessionStorage.setItem('comfy:socket-scope', previousScope)
      if (previousId === null) sessionStorage.removeItem('clientId')
      else sessionStorage.setItem('clientId', previousId)
    })
  }

  it('refreshes once on a native policy close before replacing its grant-bound sid', async () => {
    let current = scopedSession('a'.repeat(64))
    const refresh = vi.fn(async () => {
      current = scopedSession('b'.repeat(64))
      return current
    })
    socketSession(async () => current, refresh)
    sessionStorage.setItem('comfy:socket-scope', 'a'.repeat(64))
    window.name = 'old-sid'
    await api.init()
    const previous = FakeWebSocket.instances[0]
    previous.readyState = FakeWebSocket.CLOSED
    previous.handlers.close(new CloseEvent('close', { code: 1008 }))
    previous.handlers.close(new CloseEvent('close', { code: 1008 }))
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2))
    expect(refresh).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        session: expect.objectContaining({ socketScope: 'a'.repeat(64) })
      })
    )
    expect(
      new URL(FakeWebSocket.instances[1].url).searchParams.has('clientId')
    ).toBe(false)
    expect(sessionStorage.getItem('comfy:socket-scope')).toBe('b'.repeat(64))
  })

  it.for(['unchanged', 'refused', 'failed'] as const)(
    'does not retry a policy close after a %s refresh',
    async (kind) => {
      const current = scopedSession('a'.repeat(64))
      const outcomes = {
        unchanged: () => Promise.resolve(current),
        refused: () => Promise.resolve(undefined),
        failed: () => Promise.reject(Error('offline'))
      }
      const refresh = vi.fn(outcomes[kind])
      socketSession(async () => current, refresh)
      await api.init()
      vi.useFakeTimers()
      FakeWebSocket.instances[0].handlers.close(
        new CloseEvent('close', { code: 1008 })
      )
      await vi.advanceTimersByTimeAsync(1_000)
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(FakeWebSocket.instances).toHaveLength(1)
      expect(fetch).not.toHaveBeenCalled()
      vi.useRealTimers()
    }
  )

  it('leaves a newer watch-owned socket intact when the policy read settles late', async () => {
    let current = scopedSession('a'.repeat(64))
    let finish!: (scope: WebSessionRequestScope) => void
    const refresh = vi.fn(
      () =>
        new Promise<WebSessionRequestScope>((resolve) => {
          finish = resolve
        })
    )
    socketSession(async () => current, refresh)
    await api.init()
    const old = FakeWebSocket.instances[0]
    old.readyState = FakeWebSocket.CLOSED
    old.handlers.close(new CloseEvent('close', { code: 1008 }))
    current = scopedSession('b'.repeat(64))
    await api.reconnectSocket()
    const active = api.socket
    finish(current)
    await flush()
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(api.socket).toBe(active)
  })

  it('retains ordinary network reconnect behavior without policy refresh', async () => {
    const refresh = vi.fn(async () => scopedSession('b'.repeat(64)))
    socketSession(async () => scopedSession('a'.repeat(64)), refresh)
    await api.init()
    vi.useFakeTimers()
    FakeWebSocket.instances[0].handlers.close(
      new CloseEvent('close', { code: 1006 })
    )
    await vi.advanceTimersByTimeAsync(300)
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(refresh).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it.for(['first', 'replacement'] as const)(
    'retires the old sid for a %s native grant without deleting saved state',
    async (kind) => {
      const scope = 'b'.repeat(64)
      socketSession(async () => scopedSession(scope))
      if (kind === 'first') sessionStorage.removeItem('comfy:socket-scope')
      else sessionStorage.setItem('comfy:socket-scope', 'a'.repeat(64))
      window.name = 'old-sid'
      sessionStorage.setItem('clientId', 'old-sid')
      api.initialClientId = 'old-sid'
      api.clientId = 'old-sid'
      await api.init()
      expect(
        new URL(FakeWebSocket.instances[0].url).searchParams.has('clientId')
      ).toBe(false)
      expect(window.name).toBe('')
      expect(api.clientId).toBeUndefined()
      expect(api.initialClientId).toBeNull()
      expect(sessionStorage.getItem('clientId')).toBeNull()
      expect(sessionStorage.getItem('comfy:socket-scope')).toBe(scope)
    }
  )

  it.for([undefined, 'b'.repeat(64)])(
    'keeps the sid for an unchanged or upstream-absent socket scope %s',
    async (scope) => {
      socketSession(async () => scopedSession(scope))
      sessionStorage.setItem('comfy:socket-scope', 'b'.repeat(64))
      window.name = 'current-sid'
      await api.init()
      expect(
        new URL(FakeWebSocket.instances[0].url).searchParams.get('clientId')
      ).toBe('current-sid')
      expect(window.name).toBe('current-sid')
    }
  )

  it('does not adopt a superseded scope or open a socket after the current grant is refused', async () => {
    let finish!: (scope: WebSessionRequestScope | undefined) => void
    let first = true
    socketSession(() => {
      if (first) {
        first = false
        return new Promise((resolve) => {
          finish = resolve
        })
      }
      return Promise.resolve(undefined)
    })
    sessionStorage.setItem('comfy:socket-scope', 'a'.repeat(64))
    window.name = 'current-sid'
    const oldAttempt = api.init()
    currentToken = undefined
    await api.reconnectSocket()
    finish(scopedSession('b'.repeat(64)))
    await oldAttempt
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(sessionStorage.getItem('comfy:socket-scope')).toBe('a'.repeat(64))
    expect(window.name).toBe('current-sid')
  })

  it('closes the previous socket and opens a fresh one on reset', async () => {
    await api.resetSocket()
    expect(FakeWebSocket.instances).toHaveLength(1)
    const first = FakeWebSocket.instances[0]
    first.simulateOpen()

    await api.resetSocket()

    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(first.close).toHaveBeenCalled()
    expect(api.socket).toBe(FakeWebSocket.instances[1])
  })

  it('re-authenticates the new socket with the active account token', async () => {
    await api.resetSocket()
    expect(FakeWebSocket.instances[0].url).toContain('token=token-a')

    currentToken = 'token-b'
    await api.resetSocket()

    expect(FakeWebSocket.instances[1].url).toContain('token=token-b')
    expect(FakeWebSocket.instances[1].url).not.toContain('token=token-a')
  })

  it('does not let the replaced socket spawn a competing reconnect', async () => {
    await api.resetSocket()
    const stale = FakeWebSocket.instances[0]
    stale.simulateOpen()

    await api.resetSocket()
    expect(FakeWebSocket.instances).toHaveLength(2)

    // A late close event on the socket that was already replaced must be a
    // no-op; only the active socket owns the reconnect lifecycle.
    stale.handlers['close']?.(new Event('close'))
    await flush()

    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('supersedes an in-flight reset so the socket cannot settle on a stale identity', async () => {
    await api.resetSocket()
    expect(FakeWebSocket.instances).toHaveLength(1)

    deferTokenFetch = true

    // A -> B begins and parks on its token fetch (captured as token-b).
    currentToken = 'token-b'
    const firstSwitch = api.resetSocket()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // B -> C arrives before B's token resolves, bumping the connect generation.
    currentToken = 'token-c'
    const secondSwitch = api.resetSocket()

    // B's fetch resolves, but its generation was superseded, so it bails
    // without opening a socket.
    await releaseNextToken()
    // C's fetch resolves and, as the latest generation, opens the socket.
    await releaseNextToken()
    await Promise.all([firstSwitch, secondSwitch])

    const last = FakeWebSocket.instances.at(-1)!
    expect(api.socket).toBe(last)
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(last.url).toContain('token=token-c')
    expect(last.url).not.toContain('token=token-b')
  })

  it('clears the stale client id and handshake identity when resetting', async () => {
    window.name = 'client-from-account-a'
    sessionStorage.setItem('clientId', 'client-from-account-a')
    await api.resetSocket()
    api.clientId = 'client-from-account-a'

    await api.resetSocket()

    expect(api.clientId).toBeUndefined()
    expect(window.name).toBe('')
    expect(sessionStorage.getItem('clientId')).toBeNull()
  })

  it('stops queue fallback polling after a reconnect opens', async () => {
    vi.useFakeTimers()
    const fetchApi = vi
      .spyOn(api, 'fetchApi')
      .mockResolvedValue(Response.json({ exec_info: { queue_remaining: 0 } }))

    try {
      await api.resetSocket()
      FakeWebSocket.instances[0].simulateError()

      await vi.advanceTimersByTimeAsync(300)
      expect(FakeWebSocket.instances).toHaveLength(2)

      await vi.advanceTimersByTimeAsync(700)
      expect(fetchApi).toHaveBeenCalledTimes(1)

      FakeWebSocket.instances[1].simulateOpen()
      await vi.advanceTimersByTimeAsync(5_000)

      expect(fetchApi).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('turns a malformed queue fallback response into an unavailable status', async () => {
    vi.useFakeTimers()
    vi.spyOn(api, 'fetchApi').mockResolvedValue(
      Response.json({ exec_info: { queue_remaining: 'many' } })
    )
    const dispatch = vi.spyOn(api, 'dispatchCustomEvent')

    try {
      await api.resetSocket()
      FakeWebSocket.instances[0].simulateError()
      await vi.advanceTimersByTimeAsync(1_000)

      expect(dispatch).toHaveBeenCalledWith('status', null)
      expect(dispatch).not.toHaveBeenCalledWith('status', {
        exec_info: { queue_remaining: 'many' }
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
