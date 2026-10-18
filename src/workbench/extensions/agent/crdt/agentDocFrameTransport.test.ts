import { describe, expect, it, vi } from 'vitest'

import type { AgentEventSocket } from '../services/agent/agentEventSource'
import { createAgentDocFrameTransport } from './agentDocFrameTransport'
import { DocFrameClient } from './docFrameClient'
import { LayoutFollowerBridge } from './layoutFollowerBridge'

function eventSource(initialLive = true) {
  const listeners = new Set<(raw: unknown) => void>()
  const statusListeners = new Set<(live: boolean) => void>()
  const sent: string[] = []
  let live = initialLive
  const source: AgentEventSocket = {
    reconnect: vi.fn(),
    send: vi.fn((frame) => {
      if (!live) return false
      sent.push(frame)
      return true
    }),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onStatus(listener) {
      statusListeners.add(listener)
      if (live) listener(true)
      return () => statusListeners.delete(listener)
    }
  }
  return {
    source,
    sent,
    publish: (frame: unknown) =>
      listeners.forEach((listener) => listener(frame)),
    setLive(next: boolean) {
      if (live === next) return
      live = next
      statusListeners.forEach((listener) => listener(live))
    },
    listenerCount: () => listeners.size,
    statusListenerCount: () => statusListeners.size
  }
}

function frameTypes(frames: string[]): string[] {
  return frames.map((frame) => {
    const parsed: unknown = JSON.parse(frame)
    if (typeof parsed !== 'object' || parsed === null || !('type' in parsed))
      return ''
    return typeof parsed.type === 'string' ? parsed.type : ''
  })
}

function followerHarness(initialLive: boolean) {
  const events = eventSource(initialLive)
  const transport = createAgentDocFrameTransport(events.source)
  const client = new DocFrameClient(transport)
  const bridge = new LayoutFollowerBridge(client)
  return {
    ...events,
    bridge,
    destroy() {
      bridge.destroy()
      client.destroy()
      transport.destroy()
    }
  }
}

describe('createAgentDocFrameTransport', () => {
  it('carries document frames over the Agent event socket without forwarding Agent frames', () => {
    const events = eventSource()
    const transport = createAgentDocFrameTransport(events.source)
    const updates = vi.fn()
    transport.addEventListener('doc_update', updates)

    expect(transport.send('outbound-doc-frame')).toBe(true)
    events.publish({ type: 'agent_message_delta', data: { delta: 'ignored' } })
    events.publish({
      type: 'doc_update',
      data: { workflow_id: 'workflow', seq: 2 }
    })

    expect(events.source.send).toHaveBeenCalledWith('outbound-doc-frame')
    expect(updates).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'doc_update',
        detail: { workflow_id: 'workflow', seq: 2 }
      })
    )
  })

  it('shares one source subscription across document listeners and releases it on destroy', () => {
    const events = eventSource()
    const transport = createAgentDocFrameTransport(events.source)
    transport.addEventListener('doc_update', vi.fn())
    transport.addEventListener('doc_ops_result', vi.fn())

    expect(events.listenerCount()).toBe(1)
    transport.destroy()
    expect(events.listenerCount()).toBe(0)
  })

  it('sends a pending subscription when the Agent socket first opens', () => {
    const follower = followerHarness(false)
    follower.bridge.subscribe('workflow')

    expect(follower.bridge.subscribedWorkflowId).toBeNull()
    expect(follower.sent).toEqual([])

    follower.setLive(true)

    expect(follower.bridge.subscribedWorkflowId).toBe('workflow')
    expect(frameTypes(follower.sent)).toEqual(['doc_subscribe'])
    follower.destroy()
  })

  it('does not duplicate a subscription already sent on a live socket', () => {
    const follower = followerHarness(false)
    follower.setLive(true)
    follower.bridge.subscribe('workflow')

    follower.setLive(true)

    expect(frameTypes(follower.sent)).toEqual(['doc_subscribe'])
    follower.destroy()
  })

  it('ignores a Comfy reconnect and resubscribes after the Agent socket reconnects', () => {
    const follower = followerHarness(false)
    follower.setLive(true)
    follower.bridge.subscribe('workflow')

    follower.bridge.reconnect()
    expect(frameTypes(follower.sent)).toEqual(['doc_subscribe'])

    follower.setLive(false)
    follower.setLive(true)

    expect(frameTypes(follower.sent)).toEqual([
      'doc_subscribe',
      'doc_subscribe'
    ])
    expect(follower.bridge.subscribedWorkflowId).toBe('workflow')
    follower.destroy()
  })

  it('does not restore a subscription removed before reconnect', () => {
    const follower = followerHarness(false)
    follower.setLive(true)
    follower.bridge.subscribe('workflow')
    follower.bridge.unsubscribe()

    follower.setLive(false)
    follower.setLive(true)

    expect(frameTypes(follower.sent)).toEqual([
      'doc_subscribe',
      'doc_unsubscribe'
    ])
    expect(follower.bridge.subscribedWorkflowId).toBeNull()
    follower.destroy()
  })

  it('releases socket readiness after transport destruction', () => {
    const follower = followerHarness(false)
    follower.setLive(true)
    follower.bridge.subscribe('workflow')
    follower.destroy()
    follower.sent.splice(0)

    follower.setLive(false)
    follower.setLive(true)

    expect(follower.statusListenerCount()).toBe(0)
    expect(follower.sent).toEqual([])
  })
})
