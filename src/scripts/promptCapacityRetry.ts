import { isPoolCapacityPreparingError, PromptExecutionError } from './api'

/**
 * The initial retries are quick enough to catch an already-finishing
 * placement. Once capacity work is genuinely asynchronous, poll at most
 * every 30 seconds until the bounded 30-minute window expires.
 */
const POOL_CAPACITY_RETRY_FAST_DELAYS_MS = [
  1_000, 2_000, 5_000, 10_000, 15_000
] as const
const POOL_CAPACITY_RETRY_STEADY_DELAY_MS = 30_000
const POOL_CAPACITY_RETRY_MAX_DURATION_MS = 30 * 60 * 1_000
const POOL_CAPACITY_RETRY_MAX_ATTEMPTS = 64

export class PromptCapacityRetryCancelledError extends Error {
  constructor() {
    super('Prompt capacity retry cancelled')
    this.name = 'PromptCapacityRetryCancelledError'
  }
}

export interface PromptCapacityRetryOptions {
  /** Set false outside an instance-bound workspace editor iframe. */
  enabled?: boolean
  signal?: AbortSignal
  onRetry?: (attempt: number, delayMs: number) => void
  now?: () => number
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>
}

const waitForRetry = (delayMs: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PromptCapacityRetryCancelledError())
      return
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      reject(new PromptCapacityRetryCancelledError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })

const retryDelayForAttempt = (attempt: number): number =>
  POOL_CAPACITY_RETRY_FAST_DELAYS_MS[attempt - 1] ??
  POOL_CAPACITY_RETRY_STEADY_DELAY_MS

/**
 * Replays a prompt only while the backend reports pool capacity preparation.
 * The caller owns the operation's captured arguments, so retries do not
 * repeat workflow serialization or widget callbacks.
 */
export const retryPromptWhenCapacityPreparing = async <T>(
  operation: () => Promise<T>,
  options: PromptCapacityRetryOptions = {}
): Promise<T> => {
  if (options.enabled === false) return operation()

  const now = options.now ?? Date.now
  const sleep = options.sleep ?? waitForRetry
  const startedAt = now()
  let attempt = 0

  while (true) {
    if (options.signal?.aborted) {
      throw new PromptCapacityRetryCancelledError()
    }

    try {
      return await operation()
    } catch (error) {
      if (!(error instanceof PromptExecutionError)) throw error
      if (!isPoolCapacityPreparingError(error)) throw error

      const elapsedMs = now() - startedAt
      if (
        attempt >= POOL_CAPACITY_RETRY_MAX_ATTEMPTS ||
        elapsedMs >= POOL_CAPACITY_RETRY_MAX_DURATION_MS
      ) {
        throw error
      }

      const remainingMs = POOL_CAPACITY_RETRY_MAX_DURATION_MS - elapsedMs
      const delayMs = Math.min(retryDelayForAttempt(attempt + 1), remainingMs)
      attempt += 1
      options.onRetry?.(attempt, delayMs)
      await sleep(delayMs, options.signal)
    }
  }
}

export const isWorkspaceEditorIframe = (): boolean =>
  typeof window !== 'undefined' &&
  window.top !== window.self &&
  /^eds_/.test(window.name)
