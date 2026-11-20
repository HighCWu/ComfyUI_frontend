import { api } from '@/scripts/api'

import { isCrdtDebugEnabled } from './crdtDebugGate'
import { wireLog } from './crdtLog'
import type { DocFrameTransport } from './docFrameClient'

export const comfyApiTransport: DocFrameTransport = {
  send(frame) {
    if (api.socket?.readyState !== WebSocket.OPEN) return false
    api.socket.send(frame)
    return true
  },
  addEventListener(type, listener) {
    api.addCustomEventListener(type, listener)
  },
  removeEventListener(type, listener) {
    api.removeCustomEventListener(type, listener)
  }
}

const boundTransports: DocFrameTransport[] = []
const listenerRoutes: Array<{
  type: string
  listener: EventListener
  transport: DocFrameTransport
}> = []

function currentTransport(): DocFrameTransport {
  return boundTransports.at(-1) ?? comfyApiTransport
}

function listenerRouteIndex(type: string, listener: EventListener): number {
  for (let index = listenerRoutes.length - 1; index >= 0; index--) {
    const route = listenerRoutes[index]
    if (route.type === type && route.listener === listener) return index
  }
  return -1
}

export const apiTransport: DocFrameTransport = {
  get ownsConnectionLifecycle() {
    return currentTransport().ownsConnectionLifecycle === true
  },
  send: (frame) => currentTransport().send(frame),
  addEventListener(type, listener) {
    const transport = currentTransport()
    listenerRoutes.push({ type, listener, transport })
    transport.addEventListener(type, listener)
  },
  removeEventListener(type, listener) {
    const index = listenerRouteIndex(type, listener)
    const route = index === -1 ? undefined : listenerRoutes.splice(index, 1)[0]
    const transport = route?.transport ?? currentTransport()
    transport.removeEventListener(type, listener)
  }
}

export function bindAgentCrdtTransport(
  transport: DocFrameTransport
): () => void {
  boundTransports.push(transport)
  return () => {
    const index = boundTransports.lastIndexOf(transport)
    if (index !== -1) boundTransports.splice(index, 1)
  }
}

/**
 * Both of `wireLog.trace`'s sinks drop the detail unless the debug instrument
 * is on, so an ungated parse costs every user edit a full `JSON.parse` of the
 * `doc_ops` batch `DocFrameClient.send` just serialised, on the main thread,
 * for a value nothing reads.
 */
function traceableFrame(frame: string): Record<string, unknown> | null {
  if (!isCrdtDebugEnabled()) return null
  try {
    const parsed: unknown = JSON.parse(frame)
    return parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export function createLoggedTransport(
  transport: DocFrameTransport = apiTransport
): DocFrameTransport {
  return {
    get ownsConnectionLifecycle() {
      return transport.ownsConnectionLifecycle
    },
    send(frame) {
      const delivered = transport.send(frame)
      const parsed = traceableFrame(frame)
      wireLog.trace('ws_out', 'outbound frame', {
        delivered,
        frame: parsed,
        ...(parsed === null ? { unparsed_chars: frame.length } : {})
      })
      return delivered
    },
    addEventListener(type, listener) {
      transport.addEventListener(type, listener)
    },
    removeEventListener(type, listener) {
      transport.removeEventListener(type, listener)
    }
  }
}
