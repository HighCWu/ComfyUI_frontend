export const DOMON_COMFY_PROTOCOL = 'domon-comfy/v1'

export interface EmbeddedBridgeConfig {
  channel: string
  parentOrigin: string
}

export interface EmbeddedMessageEvent {
  data: unknown
  origin: string
  source: unknown
}

export interface EmbeddedMessageWindow {
  parent: { postMessage(message: unknown, targetOrigin: string): void }
  addEventListener(
    type: 'message',
    listener: (event: EmbeddedMessageEvent) => void
  ): void
  removeEventListener(
    type: 'message',
    listener: (event: EmbeddedMessageEvent) => void
  ): void
}

export interface EmbeddedRequest {
  id: string
  method: string
  params: Record<string, unknown>
}

export interface EmbeddedResponse {
  protocol: typeof DOMON_COMFY_PROTOCOL
  channel: string
  type: 'response'
  id: string
  ok: boolean
  result?: unknown
  error?: { code: string }
}

export interface EmbeddedHandlers {
  [method: string]: (
    params: Record<string, unknown>
  ) => Promise<unknown> | unknown
}

export class EmbeddedBridgeFailure extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

export function runWithAutoQueueDisabled<T>(
  mode: string,
  uiAutoQueueEnabled: boolean,
  operation: () => T
): T {
  if (mode !== 'disabled' || uiAutoQueueEnabled) {
    throw new EmbeddedBridgeFailure('auto_queue_active')
  }
  return operation()
}

interface CachedResponse {
  fingerprint: string
  response: Promise<EmbeddedResponse>
  settled: boolean
}

const MAX_CACHED_RESPONSES = 128
const CHANNEL_PATTERN = /^[0-9a-f]{32}$/
const MAIN_ORIGINS = new Set(['https://domon.ai', 'https://domon-ai.cn'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  )
}

function isCanonicalLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin)
    return (
      parsed.origin === origin &&
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      isLoopbackHostname(parsed.hostname)
    )
  } catch {
    return false
  }
}

export function parseEmbeddedBridgeConfig(
  search: string,
  currentHref: string,
  preservedQuery?: Partial<
    Record<'domon-embedded' | 'domon-host' | 'domon-channel', string>
  >
): EmbeddedBridgeConfig | null {
  const searchParams = new URLSearchParams(search)
  const bridgeKeys = ['domon-embedded', 'domon-host', 'domon-channel'] as const
  const queryHasBridgeKey = bridgeKeys.some((key) => searchParams.has(key))
  const values = queryHasBridgeKey
    ? bridgeKeys.map((key) => {
        const entries = searchParams.getAll(key)
        return entries.length === 1 ? entries[0] : undefined
      })
    : bridgeKeys.map((key) => preservedQuery?.[key])
  const [embedded, parentOrigin, channel] = values

  if (
    embedded !== '1' ||
    !channel ||
    !CHANNEL_PATTERN.test(channel) ||
    !parentOrigin
  ) {
    return null
  }

  let currentUrl: URL
  try {
    currentUrl = new URL(currentHref)
  } catch {
    return null
  }

  const productionFrame = currentUrl.origin === 'https://comfyui.aiapp.run'
  const localFrame =
    (currentUrl.protocol === 'http:' || currentUrl.protocol === 'https:') &&
    isLoopbackHostname(currentUrl.hostname)
  if (!productionFrame && !localFrame) return null

  const productionParent = MAIN_ORIGINS.has(parentOrigin)
  const localParent = localFrame && isCanonicalLoopbackOrigin(parentOrigin)
  if (!productionParent && !localParent) return null

  return { channel, parentOrigin }
}

function isRequest(
  value: unknown,
  config: EmbeddedBridgeConfig
): EmbeddedRequest | null {
  if (!isRecord(value)) return null
  if (
    value.protocol !== DOMON_COMFY_PROTOCOL ||
    value.channel !== config.channel ||
    value.type !== 'request' ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    value.id.length > 128 ||
    typeof value.method !== 'string' ||
    !isRecord(value.params)
  ) {
    return null
  }

  return {
    id: value.id,
    method: value.method,
    params: value.params
  }
}

function responseFor(
  config: EmbeddedBridgeConfig,
  id: string,
  outcome: { ok: true; result: unknown } | { ok: false; code: string }
): EmbeddedResponse {
  return outcome.ok
    ? {
        protocol: DOMON_COMFY_PROTOCOL,
        channel: config.channel,
        type: 'response',
        id,
        ok: true,
        result: outcome.result
      }
    : {
        protocol: DOMON_COMFY_PROTOCOL,
        channel: config.channel,
        type: 'response',
        id,
        ok: false,
        error: { code: outcome.code }
      }
}

function responseMessage(
  config: EmbeddedBridgeConfig,
  id: string,
  code: string
): EmbeddedResponse {
  return responseFor(config, id, { ok: false, code })
}

export function installEmbeddedBridgeReceiver(
  target: EmbeddedMessageWindow,
  config: EmbeddedBridgeConfig,
  handlers: EmbeddedHandlers
): () => void {
  const cache = new Map<string, CachedResponse>()
  let requestTail: Promise<void> = Promise.resolve()

  const send = (message: unknown) => {
    try {
      target.parent.postMessage(message, config.parentOrigin)
    } catch {
      return
    }
  }

  const makeCacheRoom = (): boolean => {
    if (cache.size < MAX_CACHED_RESPONSES) return true
    for (const [id, entry] of cache) {
      if (!entry.settled) continue
      cache.delete(id)
      return true
    }
    return false
  }

  const onMessage = (event: EmbeddedMessageEvent) => {
    if (event.origin !== config.parentOrigin || event.source !== target.parent)
      return

    const request = isRequest(event.data, config)
    if (!request) return

    let fingerprint: string
    try {
      fingerprint = JSON.stringify({
        method: request.method,
        params: request.params
      })
    } catch {
      send(responseMessage(config, request.id, 'invalid_request'))
      return
    }

    const cached = cache.get(request.id)
    if (cached) {
      if (cached.fingerprint !== fingerprint) {
        send(responseMessage(config, request.id, 'duplicate_id'))
        return
      }
      void cached.response.then(send)
      return
    }

    if (!makeCacheRoom()) {
      send(responseMessage(config, request.id, 'too_many_requests'))
      return
    }

    const response = requestTail.then(async () => {
      if (!Object.hasOwn(handlers, request.method)) {
        return responseMessage(config, request.id, 'unsupported_method')
      }
      const handler = handlers[request.method]

      try {
        const result = await handler(request.params)
        return responseFor(config, request.id, { ok: true, result })
      } catch (error) {
        const code =
          error instanceof EmbeddedBridgeFailure ? error.code : 'internal_error'
        return responseMessage(config, request.id, code)
      }
    })

    const entry: CachedResponse = {
      fingerprint,
      response,
      settled: false
    }
    cache.set(request.id, entry)
    requestTail = response.then(
      () => {
        entry.settled = true
      },
      () => {
        entry.settled = true
      }
    )
    void response.then(send)
  }

  target.addEventListener('message', onMessage)
  return () => target.removeEventListener('message', onMessage)
}

export function postEmbeddedReady(
  target: Window,
  config: EmbeddedBridgeConfig
): void {
  try {
    target.parent.postMessage(
      {
        protocol: DOMON_COMFY_PROTOCOL,
        channel: config.channel,
        type: 'ready'
      },
      config.parentOrigin
    )
  } catch {
    return
  }
}

export function postEmbeddedSnapshot(
  target: Window,
  config: EmbeddedBridgeConfig,
  result: { workflow: unknown; revision: string }
): void {
  try {
    target.parent.postMessage(
      {
        protocol: DOMON_COMFY_PROTOCOL,
        channel: config.channel,
        type: 'snapshot',
        result
      },
      config.parentOrigin
    )
  } catch {
    return
  }
}
