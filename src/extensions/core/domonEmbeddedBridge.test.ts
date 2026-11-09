import { describe, expect, it, vi } from 'vitest'

import {
  DOMON_COMFY_PROTOCOL,
  installEmbeddedBridgeReceiver,
  parseEmbeddedBridgeConfig,
  runWithAutoQueueDisabled
} from './domonEmbeddedBridge'
import type {
  EmbeddedMessageEvent,
  EmbeddedMessageWindow
} from './domonEmbeddedBridge'

const CHANNEL = '0123456789abcdef0123456789abcdef'
const PARENT = 'https://domon.ai'
const FRAME = 'https://comfyui.aiapp.run/comfy/'

function bridgeTarget() {
  const sent: unknown[] = []
  let receive: ((event: EmbeddedMessageEvent) => void) | undefined
  const parent = { postMessage: (message: unknown) => sent.push(message) }
  const target: EmbeddedMessageWindow = {
    parent,
    addEventListener: (
      _type: 'message',
      listener: (event: EmbeddedMessageEvent) => void
    ) => {
      receive = listener
    },
    removeEventListener: vi.fn()
  }

  return {
    target,
    sent,
    deliver(data: unknown, origin = PARENT, source: unknown = parent) {
      receive?.({ data, origin, source })
    }
  }
}

const request = (id: string, method = 'workflow.read', params = {}) => ({
  protocol: DOMON_COMFY_PROTOCOL,
  channel: CHANNEL,
  type: 'request',
  id,
  method,
  params
})

describe('embedded Comfy bridge configuration', () => {
  it.for([
    [FRAME, PARENT, CHANNEL],
    ['http://localhost:3090/comfy/', 'http://localhost:3093', CHANNEL],
    ['http://127.0.0.1:3090/comfy/', 'https://localhost:3093', CHANNEL]
  ])('accepts an approved frame/parent pair', ([href, host, channel]) => {
    expect(
      parseEmbeddedBridgeConfig(
        `?domon-embedded=1&domon-host=${encodeURIComponent(host)}&domon-channel=${channel}`,
        href
      )
    ).toEqual({ parentOrigin: host, channel })
  })

  it.for([
    ['https://comfyui.aiapp.run.evil.test/comfy/', PARENT, CHANNEL],
    [FRAME, 'https://domon.ai.evil.test', CHANNEL],
    [FRAME, 'http://domon.ai', CHANNEL],
    ['https://remote.example/comfy/', 'http://localhost:3093', CHANNEL],
    ['http://localhost:3090/comfy/', 'https://domon.ai', 'a'.repeat(31)],
    [FRAME, PARENT, CHANNEL.toUpperCase()]
  ])('rejects an unapproved frame/parent tuple', ([href, host, channel]) => {
    expect(
      parseEmbeddedBridgeConfig(
        `?domon-embedded=1&domon-host=${encodeURIComponent(host)}&domon-channel=${channel}`,
        href
      )
    ).toBeNull()
  })

  it('rejects repeated or partial query tuples instead of mixing stale values', () => {
    expect(
      parseEmbeddedBridgeConfig(
        `?domon-embedded=1&domon-embedded=1&domon-host=${PARENT}&domon-channel=${CHANNEL}`,
        FRAME,
        {
          'domon-embedded': '1',
          'domon-host': PARENT,
          'domon-channel': CHANNEL
        }
      )
    ).toBeNull()
    expect(
      parseEmbeddedBridgeConfig(
        `?domon-embedded=1&domon-channel=${CHANNEL}`,
        FRAME,
        {
          'domon-host': PARENT
        }
      )
    ).toBeNull()
  })
})

describe('embedded Comfy bridge receiver', () => {
  it('does not perform a graph mutation while automatic queueing is enabled', () => {
    const mutation = vi.fn(() => 'changed')

    for (const mode of ['change', 'instant-idle', 'instant-running']) {
      expect(() => runWithAutoQueueDisabled(mode, false, mutation)).toThrow(
        'auto_queue_active'
      )
    }
    expect(() => runWithAutoQueueDisabled('disabled', true, mutation)).toThrow(
      'auto_queue_active'
    )
    expect(mutation).not.toHaveBeenCalled()
    expect(runWithAutoQueueDisabled('disabled', false, mutation)).toBe(
      'changed'
    )
    expect(mutation).toHaveBeenCalledOnce()
  })

  it('checks source, origin, channel and protocol before dispatching', async () => {
    const { target, sent, deliver } = bridgeTarget()
    const handler = vi.fn(() => ({ workflow: {} }))
    const remove = installEmbeddedBridgeReceiver(
      target,
      { parentOrigin: PARENT, channel: CHANNEL },
      { 'workflow.read': handler }
    )

    deliver(request('bad-origin'), 'https://other.example')
    deliver(request('bad-source'), PARENT, {})
    deliver({ ...request('bad-channel'), channel: 'f'.repeat(32) })
    deliver({ ...request('bad-protocol'), protocol: 'other/v1' })
    expect(handler).not.toHaveBeenCalled()

    deliver(request('accepted'))
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(handler).toHaveBeenCalledOnce()
    expect(sent[0]).toMatchObject({
      protocol: DOMON_COMFY_PROTOCOL,
      channel: CHANNEL,
      type: 'response',
      id: 'accepted',
      ok: true,
      result: { workflow: {} }
    })
    remove()
  })

  it('serializes mutations and replays duplicate ids without applying twice', async () => {
    const { target, sent, deliver } = bridgeTarget()
    let releaseFirst: (() => void) | undefined
    const applied: string[] = []
    const handlers = {
      mutate: async (params: Record<string, unknown>) => {
        const value = String(params.value)
        applied.push(`start:${value}`)
        if (value === 'first') {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve
          })
        }
        applied.push(`end:${value}`)
        return value
      }
    }
    installEmbeddedBridgeReceiver(
      target,
      { parentOrigin: PARENT, channel: CHANNEL },
      handlers
    )

    deliver(request('one', 'mutate', { value: 'first' }))
    deliver(request('one', 'mutate', { value: 'first' }))
    deliver(request('two', 'mutate', { value: 'second' }))
    await vi.waitFor(() => expect(applied).toEqual(['start:first']))
    releaseFirst?.()
    await vi.waitFor(() => expect(sent).toHaveLength(3))

    expect(applied).toEqual([
      'start:first',
      'end:first',
      'start:second',
      'end:second'
    ])
    expect(
      sent.filter((message) => (message as { id: string }).id === 'one')
    ).toHaveLength(2)
  })

  it('does not dispatch inherited object methods as protocol methods', async () => {
    const { target, sent, deliver } = bridgeTarget()
    installEmbeddedBridgeReceiver(
      target,
      { parentOrigin: PARENT, channel: CHANNEL },
      {}
    )
    deliver(request('unknown', 'toString'))

    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({
      id: 'unknown',
      ok: false,
      error: { code: 'unsupported_method' }
    })
  })
})
