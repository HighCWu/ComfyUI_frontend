import { describe, expect, it, onTestFinished, vi } from 'vitest'

import type { DocFrameTransport } from './docFrameClient'
import {
  apiTransport,
  bindAgentCrdtTransport,
  createLoggedTransport
} from './agentCrdtTransport'

function transport(
  sent: string[],
  ownsConnectionLifecycle = false
): DocFrameTransport {
  return {
    ownsConnectionLifecycle,
    send(frame) {
      sent.push(frame)
      return true
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }
}

describe('bindAgentCrdtTransport', () => {
  it('uses the newest live binding and restores the previous binding on release', () => {
    const first: string[] = []
    const second: string[] = []
    const releaseFirst = bindAgentCrdtTransport(transport(first))
    const releaseSecond = bindAgentCrdtTransport(transport(second))
    onTestFinished(() => {
      releaseSecond()
      releaseFirst()
    })

    expect(apiTransport.send('newest')).toBe(true)
    releaseSecond()
    expect(apiTransport.send('restored')).toBe(true)
    releaseFirst()

    expect(first).toEqual(['restored'])
    expect(second).toEqual(['newest'])
  })

  it('does not resurrect an earlier binding released before the active one', () => {
    const first: string[] = []
    const second: string[] = []
    const releaseFirst = bindAgentCrdtTransport(transport(first))
    const releaseSecond = bindAgentCrdtTransport(transport(second))
    onTestFinished(() => {
      releaseSecond()
      releaseFirst()
    })

    releaseFirst()
    expect(apiTransport.send('active')).toBe(true)
    releaseSecond()

    expect(first).toEqual([])
    expect(second).toEqual(['active'])
  })

  it('removes each listener from the transport that originally received it', () => {
    const bound = transport([])
    const release = bindAgentCrdtTransport(bound)
    onTestFinished(release)
    const listener = vi.fn()
    apiTransport.addEventListener('doc_update', listener)
    onTestFinished(() =>
      apiTransport.removeEventListener('doc_update', listener)
    )

    release()
    apiTransport.removeEventListener('doc_update', listener)

    expect(bound.addEventListener).toHaveBeenCalledWith('doc_update', listener)
    expect(bound.removeEventListener).toHaveBeenCalledWith(
      'doc_update',
      listener
    )
  })

  it('exposes connection lifecycle ownership only while its transport is active', () => {
    const release = bindAgentCrdtTransport(transport([], true))
    onTestFinished(release)
    const logged = createLoggedTransport()

    expect(apiTransport.ownsConnectionLifecycle).toBe(true)
    expect(logged.ownsConnectionLifecycle).toBe(true)
    release()

    expect(apiTransport.ownsConnectionLifecycle).toBe(false)
    expect(logged.ownsConnectionLifecycle).toBe(false)
  })
})
