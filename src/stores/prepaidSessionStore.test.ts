import { expect, it, onTestFinished, vi } from 'vitest'

import { usePrepaidSessionStore } from './prepaidSessionStore'
import {
  remoteConfig,
  remoteConfigState,
  sessionAgentGrant
} from '@/platform/remoteConfig/remoteConfig'

it('bounds a shared hanging session read and cancels its transport without retrying', async () => {
  vi.useFakeTimers()
  onTestFinished(() => {
    vi.useRealTimers()
  })
  let signal: AbortSignal | undefined
  vi.mocked(fetch).mockImplementation(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        signal = init?.signal ?? undefined
        signal?.addEventListener('abort', () => reject(signal?.reason), {
          once: true
        })
      })
  )
  const store = usePrepaidSessionStore()
  const first = store.initialize()
  const second = store.initialize()
  await vi.advanceTimersByTimeAsync(14_999)
  expect(store.initialized).toBe(false)
  expect(signal?.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  await Promise.all([first, second])
  expect(signal?.aborted).toBe(true)
  expect(store.initialized).toBe(true)
  expect(store.user).toBeNull()
  expect(fetch).toHaveBeenCalledOnce()
})

it('releases the timeout after a successful session read', async () => {
  vi.useFakeTimers()
  onTestFinished(() => {
    vi.useRealTimers()
  })
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      user: {
        id: 'owner',
        name: 'QA',
        email: 'qa@example.test',
        emailVerified: true
      }
    })
  )
  const store = usePrepaidSessionStore()
  await store.initialize()
  const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal
  await vi.advanceTimersByTimeAsync(15_000)
  expect(signal?.aborted).toBe(false)
  expect(store.user?.id).toBe('owner')
  expect(fetch).toHaveBeenCalledOnce()
})

it('invalidates prior account configuration before refreshing a prepaid session', async () => {
  vi.stubEnv('VITE_RUN_BILLING_MODE', 'prepaid')
  remoteConfig.value = { 'agent-in-app-experience': true }
  sessionAgentGrant.value = true
  vi.mocked(fetch).mockResolvedValue(Response.json(null))

  const refresh = usePrepaidSessionStore().refresh()

  expect(remoteConfig.value).toEqual({})
  expect(remoteConfigState.value).toBe('unloaded')
  expect(sessionAgentGrant.value).toBeUndefined()
  await refresh
})

it('does not restore an expired account from an earlier in-flight session read', async () => {
  let complete!: (response: Response) => void
  const delayed = new Promise<Response>((resolve) => {
    complete = resolve
  })
  vi.mocked(fetch)
    .mockReturnValueOnce(delayed)
    .mockResolvedValueOnce(Response.json(null))
  const store = usePrepaidSessionStore()
  const initial = store.initialize()
  await store.refresh()
  complete(
    Response.json({
      user: {
        id: 'expired',
        name: 'Old',
        email: 'old@example.test',
        emailVerified: true
      }
    })
  )
  await initial
  expect(store.user).toBeNull()
})

it('resolves the server identity and clears it when the session expires', async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      Response.json({
        user: {
          id: 'owner',
          name: 'QA',
          email: 'qa@example.test',
          emailVerified: true
        }
      })
    )
    .mockResolvedValueOnce(Response.json(null))
  const store = usePrepaidSessionStore()
  await store.initialize()
  expect(store.user?.id).toBe('owner')
  await store.refresh()
  expect(store.user).toBeNull()
  expect(store.initialized).toBe(true)
})

it.for([
  Response.json({ user: { id: 'forged' } }),
  new Response(null, { status: 401 })
])('rejects absent or malformed identities', async (response) => {
  vi.mocked(fetch).mockResolvedValue(response)
  const store = usePrepaidSessionStore()
  await store.initialize()
  expect(store.user).toBeNull()
  expect(store.initialized).toBe(true)
})

it('preserves the server socket scope and clears it with an expired session', async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      Response.json({
        user: {
          id: 'owner',
          name: 'QA',
          email: 'qa@example.test',
          emailVerified: true
        },
        socket_scope: 'a'.repeat(64)
      })
    )
    .mockResolvedValueOnce(Response.json(null))
  const store = usePrepaidSessionStore()
  await store.initialize()
  expect(store.socketScope).toBe('a'.repeat(64))
  await store.refresh()
  expect(store.socketScope).toBeNull()
})
