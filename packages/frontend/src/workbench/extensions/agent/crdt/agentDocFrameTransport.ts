import type { AgentEventSocket } from '../services/agent/agentEventSource'
import {
  DOC_TRANSPORT_READY_EVENT,
  SERVER_DOC_FRAME_TYPES
} from './docFrameCodes'
import type { DocFrameTransport } from './docFrameClient'

const inboundDocFrames = new Set<string>(SERVER_DOC_FRAME_TYPES)

export interface AgentDocFrameTransport extends DocFrameTransport {
  destroy(): void
}

export function createAgentDocFrameTransport(
  source: AgentEventSocket
): AgentDocFrameTransport {
  const target = new EventTarget()
  let unsubscribe: (() => void) | null = null
  let unsubscribeStatus: (() => void) | null = source.onStatus((live) => {
    if (live) target.dispatchEvent(new Event(DOC_TRANSPORT_READY_EVENT))
  })

  function subscribe(): void {
    if (unsubscribe !== null) return
    unsubscribe = source.subscribe((raw) => {
      if (typeof raw !== 'object' || raw === null || !('type' in raw)) return
      const { type } = raw
      if (typeof type !== 'string' || !inboundDocFrames.has(type)) return
      const detail = 'data' in raw ? raw.data : undefined
      target.dispatchEvent(new CustomEvent(type, { detail }))
    })
  }

  return {
    ownsConnectionLifecycle: true,
    send: (frame) => source.send(frame),
    addEventListener(type, listener) {
      target.addEventListener(type, listener)
      subscribe()
    },
    removeEventListener: (type, listener) =>
      target.removeEventListener(type, listener),
    destroy() {
      unsubscribe?.()
      unsubscribe = null
      unsubscribeStatus?.()
      unsubscribeStatus = null
    }
  }
}
