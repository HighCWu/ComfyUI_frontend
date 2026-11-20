import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAgentEventSource,
  createAgentHostEventSource
} from './agentEventSource'
import type { AgentEventHost } from './agentEventSource'

class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static instances: FakeSocket[] = []

  readyState = FakeSocket.CONNECTING
  send = vi.fn()

  constructor(readonly url: string) {
    super()
    FakeSocket.instances.push(this)
  }

  open(): void {
    this.readyState = FakeSocket.OPEN
    this.dispatchEvent(new Event('open'))
  }

  receive(frame: unknown): void {
    this.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(frame) })
    )
  }

  receiveRaw(data: string): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  error(): void {
    this.dispatchEvent(new Event('error'))
  }

  close(): void {
    if (this.readyState === FakeSocket.CLOSED) return
    this.readyState = FakeSocket.CLOSED
    this.dispatchEvent(new Event('close'))
  }
}

function createSource(
  getAuthParams: () => Promise<URLSearchParams | null> = async () =>
    new URLSearchParams()
) {
  return createAgentEventSource({
    endpoint: '/api/agent/events',
    getAuthParams,
    random: () => 1
  })
}

async function connect(): Promise<FakeSocket> {
  await vi.advanceTimersByTimeAsync(0)
  const socket = FakeSocket.instances.at(-1)
  if (!socket) throw new Error('Expected an Agent event socket')
  return socket
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false })
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
})

describe('createAgentEventSource', () => {
  it.for([
    ['http://agent.test/api/agent/events', 'ws:'],
    ['https://agent.test/api/agent/events', 'wss:']
  ])(
    'transforms %s into a %s socket endpoint',
    async ([endpoint, protocol]) => {
      const source = createAgentEventSource({
        endpoint,
        getAuthParams: async () => new URLSearchParams()
      })

      source.subscribe(vi.fn())
      const socketUrl = new URL((await connect()).url)

      expect(socketUrl.protocol).toBe(protocol)
      expect(socketUrl.host).toBe('agent.test')
      expect(socketUrl.pathname).toBe('/api/agent/events')
      expect(socketUrl.search).toBe('')
    }
  )

  it('adds an explicit credential without requiring one for same-origin sessions', async () => {
    const source = createSource(
      async () => new URLSearchParams({ token: 'socket-token' })
    )

    source.subscribe(vi.fn())

    expect(new URL((await connect()).url).searchParams.get('token')).toBe(
      'socket-token'
    )
  })

  it('does not open a socket without an authenticated session', async () => {
    const source = createSource(async () => null)

    source.subscribe(vi.fn())
    await vi.advanceTimersByTimeAsync(60_000)

    expect(FakeSocket.instances).toHaveLength(0)
  })

  it('delivers JSON and raw frames and sends document frames only while live', async () => {
    const source = createSource()
    const seen = vi.fn()

    source.subscribe(seen)
    const socket = await connect()
    expect(source.send('before-open')).toBe(false)
    socket.open()
    socket.receive({ type: 'agent_message_delta', data: { delta: 'hi' } })
    socket.receiveRaw('')
    expect(source.send('doc-frame')).toBe(true)

    expect(seen.mock.calls).toEqual([
      [{ type: 'agent_message_delta', data: { delta: 'hi' } }],
      ['']
    ])
    expect(socket.send).toHaveBeenCalledWith('doc-frame')
  })

  it('replaces the authenticated socket and ignores frames from the old account', async () => {
    const auth = vi.fn(async () => new URLSearchParams())
    const source = createSource(auth)
    const seen = vi.fn()

    source.subscribe(seen)
    const oldSocket = await connect()
    oldSocket.open()
    source.reconnect()
    const newSocket = await connect()
    newSocket.open()
    oldSocket.receive({ type: 'agent_message_delta', data: { delta: 'old' } })
    newSocket.receive({ type: 'agent_message_delta', data: { delta: 'new' } })

    expect(oldSocket.readyState).toBe(FakeSocket.CLOSED)
    expect(auth).toHaveBeenCalledTimes(2)
    expect(seen).toHaveBeenCalledExactlyOnceWith({
      type: 'agent_message_delta',
      data: { delta: 'new' }
    })
  })

  it('backs off after an unavailable credential and connects when it recovers', async () => {
    const auth = vi
      .fn<() => Promise<URLSearchParams | null>>()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValue(new URLSearchParams())
    const source = createSource(auth)
    const status = vi.fn()

    source.onStatus(status)
    source.subscribe(vi.fn())
    await vi.advanceTimersByTimeAsync(999)
    expect(FakeSocket.instances).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)

    expect(await connect()).toBeDefined()
    expect(auth).toHaveBeenCalledTimes(2)
    expect(status).toHaveBeenCalledWith(false)
  })

  it('reconnects after a backend reload and stops after unsubscribe', async () => {
    const source = createSource()
    const unsubscribe = source.subscribe(vi.fn())
    const socket = await connect()
    socket.open()
    socket.close()
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakeSocket.instances).toHaveLength(2)

    FakeSocket.instances[1].close()
    unsubscribe()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(FakeSocket.instances).toHaveLength(2)
  })
})

describe('createAgentHostEventSource', () => {
  function hostHarness(readyState: number | null = null) {
    const target = new EventTarget()
    const host: AgentEventHost = {
      socket: readyState === null ? null : { readyState },
      addCustomEventListener: (type, listener) =>
        target.addEventListener(type, listener as EventListener),
      removeCustomEventListener: (type, listener) =>
        target.removeEventListener(type, listener as EventListener),
      addEventListener: (type, listener) =>
        target.addEventListener(type, listener),
      removeEventListener: (type, listener) =>
        target.removeEventListener(type, listener)
    }
    return {
      host,
      emit: (type: string, detail?: unknown) =>
        target.dispatchEvent(new CustomEvent(type, { detail }))
    }
  }

  it('projects host events into Agent frames until unsubscribe', () => {
    const { host, emit } = hostHarness()
    const seen = vi.fn()
    const unsubscribe = createAgentHostEventSource(host).subscribe(seen)

    emit('agent_message_delta', { delta: 'current' })
    unsubscribe()
    emit('agent_message_delta', { delta: 'late' })

    expect(seen).toHaveBeenCalledExactlyOnceWith({
      type: 'agent_message_delta',
      data: { delta: 'current' }
    })
  })

  it('maps the host socket and reconnect lifecycle to liveness', () => {
    const { host, emit } = hostHarness(WebSocket.OPEN)
    const status = vi.fn()
    const unsubscribe = createAgentHostEventSource(host).onStatus?.(status)

    emit('reconnecting')
    emit('reconnected')
    unsubscribe?.()
    emit('reconnecting')

    expect(status.mock.calls).toEqual([[true], [false], [true]])
  })
})
