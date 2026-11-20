import { describe, expect, it, vi } from 'vitest'

import { resolveAgentIdentity } from './agentIdentity'

function harness(
  getIdentity: () => Promise<{ userId: string }>,
  isRetryable: (error: unknown) => boolean = () => true,
  isAvailable: () => boolean = () => true
) {
  let socketOpen: (() => void) | null = null
  const onFailure = vi.fn()
  const identity = resolveAgentIdentity({
    getIdentity,
    isAvailable,
    isRetryable,
    onFailure,
    onSocketOpen(listener) {
      socketOpen = listener
      return () => {
        socketOpen = null
      }
    }
  })
  return {
    identity,
    onFailure,
    openSocket: () => socketOpen?.()
  }
}

describe('resolveAgentIdentity', () => {
  it('resolves the backend user identity', async () => {
    const getIdentity = vi.fn(async () => ({ userId: 'backend-user' }))
    const { identity } = harness(getIdentity)

    await vi.waitFor(() =>
      expect(identity.state.value).toEqual({
        status: 'resolved',
        userId: 'backend-user'
      })
    )
    expect(getIdentity).toHaveBeenCalledOnce()
  })

  it('retries a transient failure when the socket reconnects', async () => {
    vi.useFakeTimers()
    const getIdentity = vi
      .fn<() => Promise<{ userId: string }>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ userId: 'recovered-user' })
    const { identity, onFailure, openSocket } = harness(getIdentity)

    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce())
    openSocket()
    await vi.waitFor(() =>
      expect(identity.state.value).toEqual({
        status: 'resolved',
        userId: 'recovered-user'
      })
    )
    expect(getIdentity).toHaveBeenCalledTimes(2)
  })

  it('holds a permanent failure until reset', async () => {
    const getIdentity = vi
      .fn<() => Promise<{ userId: string }>>()
      .mockRejectedValueOnce(new Error('forbidden'))
      .mockResolvedValueOnce({ userId: 'next-user' })
    const { identity, openSocket } = harness(getIdentity, () => false)

    await vi.waitFor(() =>
      expect(identity.state.value).toEqual({ status: 'rejected' })
    )
    openSocket()
    expect(getIdentity).toHaveBeenCalledOnce()

    identity.reset()
    await vi.waitFor(() =>
      expect(identity.state.value).toEqual({
        status: 'resolved',
        userId: 'next-user'
      })
    )
  })

  it('waits without a request until the authenticated session is available', async () => {
    let available = false
    const getIdentity = vi.fn(async () => ({ userId: 'signed-in-user' }))
    const { identity } = harness(
      getIdentity,
      () => true,
      () => available
    )

    await Promise.resolve()
    expect(getIdentity).not.toHaveBeenCalled()
    expect(identity.state.value).toEqual({ status: 'pending' })

    available = true
    identity.reset()
    await vi.waitFor(() =>
      expect(identity.state.value).toEqual({
        status: 'resolved',
        userId: 'signed-in-user'
      })
    )
  })

  it('ignores a late response after stop', async () => {
    const request = Promise.withResolvers<{ userId: string }>()
    const getIdentity = vi.fn(() => request.promise)
    const { identity } = harness(getIdentity)

    identity.stop()
    request.resolve({ userId: 'late-user' })
    await Promise.resolve()

    expect(identity.state.value).toEqual({ status: 'pending' })
  })
})
