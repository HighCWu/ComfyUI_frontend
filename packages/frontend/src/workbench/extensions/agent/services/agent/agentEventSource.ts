import { useTimeoutFn } from '@vueuse/core'

import type { AgentEventSource } from '../../composables/agent/useAgentSession'
import { AGENT_WS_EVENT_TYPES } from '../../schemas/agentApiSchema'

export interface AgentEventSocket extends AgentEventSource {
  send(frame: string): boolean
  reconnect(): void
  onStatus(listener: (live: boolean) => void): () => void
}

interface AgentEventSourceOptions {
  endpoint: string
  getAuthParams: () => Promise<URLSearchParams | null>
  reconnectDelayMs?: number
  maxReconnectDelayMs?: number
  random?: () => number
}

type AuthRead = { ok: true; params: URLSearchParams | null } | { ok: false }

export interface AgentEventHost {
  socket: { readyState: number } | null
  addCustomEventListener(
    type: string,
    listener: (event: CustomEvent<unknown>) => void
  ): void
  removeCustomEventListener(
    type: string,
    listener: (event: CustomEvent<unknown>) => void
  ): void
  addEventListener(
    type: 'reconnecting' | 'reconnected',
    listener: () => void
  ): void
  removeEventListener(
    type: 'reconnecting' | 'reconnected',
    listener: () => void
  ): void
}

export function createAgentHostEventSource(
  host: AgentEventHost
): AgentEventSource {
  return {
    subscribe(listener) {
      const unbinders = [...AGENT_WS_EVENT_TYPES].map((type) => {
        const onEvent = (event: CustomEvent<unknown>): void =>
          listener({ type, data: event.detail })
        host.addCustomEventListener(type, onEvent)
        return () => host.removeCustomEventListener(type, onEvent)
      })
      return () => unbinders.forEach((unbind) => unbind())
    },
    onStatus(listener) {
      const onDown = (): void => listener(false)
      const onUp = (): void => listener(true)
      host.addEventListener('reconnecting', onDown)
      host.addEventListener('reconnected', onUp)
      listener(host.socket?.readyState === WebSocket.OPEN)
      return () => {
        host.removeEventListener('reconnecting', onDown)
        host.removeEventListener('reconnected', onUp)
      }
    }
  }
}

export function createAgentEventSource({
  endpoint,
  getAuthParams,
  reconnectDelayMs = 1000,
  maxReconnectDelayMs = 30_000,
  random = Math.random
}: AgentEventSourceOptions): AgentEventSocket {
  const listeners = new Set<(raw: unknown) => void>()
  const statusListeners = new Set<(live: boolean) => void>()
  let socket: WebSocket | null = null
  let nextReconnectDelayMs = reconnectDelayMs
  const reconnectTimer = useTimeoutFn(
    () => void connect(),
    () => nextReconnectDelayMs,
    { immediate: false }
  )
  let connectGeneration = 0
  let connecting = false
  let failedConnects = 0

  function eventUrl(authParams: URLSearchParams): string {
    const url = new URL(endpoint, window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    for (const [name, value] of authParams) url.searchParams.set(name, value)
    return url.toString()
  }

  function notifyStatus(live: boolean): void {
    statusListeners.forEach((listener) => listener(live))
  }

  function scheduleReconnect(): void {
    if (listeners.size === 0 || reconnectTimer.isPending.value) return
    const ceiling = Math.min(
      maxReconnectDelayMs,
      reconnectDelayMs * 2 ** failedConnects
    )
    failedConnects += 1
    nextReconnectDelayMs = ceiling * (0.5 + 0.5 * random())
    reconnectTimer.start()
  }

  async function connect(): Promise<void> {
    if (listeners.size === 0 || socket !== null || connecting) return
    connecting = true
    const generation = connectGeneration
    let auth: AuthRead
    try {
      auth = { ok: true, params: await getAuthParams() }
    } catch {
      auth = { ok: false }
    } finally {
      connecting = false
    }
    if (generation !== connectGeneration) {
      void connect()
      return
    }
    if (listeners.size === 0) return
    if (!auth.ok) {
      notifyStatus(false)
      scheduleReconnect()
      return
    }
    if (auth.params === null) return
    open(eventUrl(auth.params))
  }

  function open(url: string): void {
    const current = new WebSocket(url)
    socket = current
    let openedAt: number | null = null
    current.addEventListener('open', () => {
      if (socket !== current) return
      openedAt = Date.now()
      notifyStatus(true)
    })
    current.addEventListener('message', (event) => {
      if (socket !== current) return
      failedConnects = 0
      let frame: unknown = event.data
      if (typeof event.data === 'string') {
        try {
          frame = JSON.parse(event.data)
        } catch {
          frame = event.data
        }
      }
      listeners.forEach((listener) => listener(frame))
    })
    current.addEventListener('error', () => {
      if (socket === current) current.close()
    })
    current.addEventListener('close', () => {
      if (socket !== current) return
      if (openedAt !== null && Date.now() - openedAt >= maxReconnectDelayMs)
        failedConnects = 0
      socket = null
      notifyStatus(false)
      scheduleReconnect()
    })
  }

  function disconnect(): void {
    connectGeneration++
    reconnectTimer.stop()
    const current = socket
    socket = null
    if (current === null) return
    current.close()
    notifyStatus(false)
  }

  return {
    reconnect() {
      disconnect()
      failedConnects = 0
      void connect()
    },
    send(frame) {
      if (socket?.readyState !== WebSocket.OPEN) return false
      socket.send(frame)
      return true
    },
    subscribe(listener) {
      listeners.add(listener)
      void connect()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) disconnect()
      }
    },
    onStatus(listener) {
      statusListeners.add(listener)
      listener(socket?.readyState === WebSocket.OPEN)
      return () => statusListeners.delete(listener)
    }
  }
}
