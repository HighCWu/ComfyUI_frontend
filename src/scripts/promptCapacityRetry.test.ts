import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PromptResponse } from '@/schemas/apiSchema'
import { POOL_CAPACITY_PREPARING_CODE, PromptExecutionError } from './api'
import {
  isWorkspaceEditorIframe,
  PromptCapacityRetryCancelledError,
  retryPromptWhenCapacityPreparing
} from './promptCapacityRetry'

const poolCapacityError = (): PromptExecutionError =>
  new PromptExecutionError(
    {
      error: {
        type: 'conflict',
        message: 'capacity is preparing',
        details: { code: POOL_CAPACITY_PREPARING_CODE }
      }
    } as unknown as PromptResponse,
    409
  )

describe('retryPromptWhenCapacityPreparing', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('retries the exact capacity-preparing error and reuses the operation', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(poolCapacityError())
      .mockResolvedValueOnce('queued')
    const sleep = vi.fn().mockResolvedValue(undefined)
    const onRetry = vi.fn()

    await expect(
      retryPromptWhenCapacityPreparing(operation, {
        enabled: true,
        sleep,
        onRetry
      })
    ).resolves.toBe('queued')

    expect(operation).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(1_000, undefined)
    expect(onRetry).toHaveBeenCalledWith(1, 1_000)
  })

  it('does not retry a different error code or when disabled', async () => {
    const otherError = new PromptExecutionError(
      {
        error: {
          type: 'conflict',
          message: 'not retryable',
          details: { code: 'pool_not_ready' }
        }
      } as unknown as PromptResponse,
      409
    )
    const operation = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(otherError)
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(
      retryPromptWhenCapacityPreparing(operation, { sleep })
    ).rejects.toBe(otherError)
    await expect(
      retryPromptWhenCapacityPreparing(
        vi.fn<() => Promise<never>>().mockRejectedValue(poolCapacityError()),
        { enabled: false, sleep }
      )
    ).rejects.toBeInstanceOf(PromptExecutionError)

    expect(operation).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('does not retry a non-conflict response that reuses the capacity code', async () => {
    const serverError = poolCapacityError()
    serverError.status = 500
    const operation = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(serverError)
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(
      retryPromptWhenCapacityPreparing(operation, { sleep })
    ).rejects.toBe(serverError)

    expect(operation).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('stops waiting when the retry signal is aborted', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const operation = vi
        .fn<() => Promise<never>>()
        .mockRejectedValue(poolCapacityError())
      const promise = retryPromptWhenCapacityPreparing(operation, {
        signal: controller.signal
      })

      await vi.advanceTimersByTimeAsync(0)
      controller.abort()

      await expect(promise).rejects.toBeInstanceOf(
        PromptCapacityRetryCancelledError
      )
      expect(operation).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('isWorkspaceEditorIframe', () => {
  it('requires both an eds window name and an iframe context', () => {
    const originalName = window.name
    const originalTop = Object.getOwnPropertyDescriptor(window, 'top')

    Object.defineProperty(window, 'name', {
      configurable: true,
      value: 'eds_instance-1'
    })
    Object.defineProperty(window, 'top', {
      configurable: true,
      value: {}
    })

    expect(isWorkspaceEditorIframe()).toBe(true)

    Object.defineProperty(window, 'name', {
      configurable: true,
      value: 'comfy-instance-1'
    })
    expect(isWorkspaceEditorIframe()).toBe(false)

    Object.defineProperty(window, 'name', {
      configurable: true,
      value: originalName
    })
    if (originalTop) Object.defineProperty(window, 'top', originalTop)
  })
})
