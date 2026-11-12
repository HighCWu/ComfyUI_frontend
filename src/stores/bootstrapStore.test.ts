import type { WebSession } from '@comfyorg/account-core/webSession'
import { bootCloudIdentity } from '@/platform/auth/session/cloudIdentityBoot'
import { useCloudWebSessionStore } from '@/platform/auth/session/cloudWebSessionStore'
import { useAuthStore } from '@/stores/authStore'
import { useUserStore } from '@/stores/userStore'
import { useWorkflowStore } from '@/platform/workflow/management/stores/workflowStore'
import { fromPartial } from '@total-typescript/shoehorn'
import type { AxiosResponse } from 'axios'
import { AxiosError } from 'axios'
import { assert, beforeEach, describe, expect, it, vi } from 'vitest'

import { mergeCustomNodesI18n } from '@/i18n'
import * as i18nModule from '@/i18n'
import { useSettingStore } from '@/platform/settings/settingStore'
import { bootstrapTracer } from '@/platform/telemetry/perf/bootstrapTracer'
import { api, ComfyApi } from '@/scripts/api'

import { useBootstrapStore } from './bootstrapStore'

vi.mock(import('firebase/auth'))
vi.mock(import('@/platform/auth/session/cloudIdentityBoot'))

const mockDistributionTypes = vi.hoisted(() => ({
  isCloud: false
}))
vi.mock(import('@/platform/distribution/types'), () => mockDistributionTypes)

const mockReportError = vi.hoisted(() => vi.fn())
vi.mock(import('@/platform/telemetry/reportError'), () => ({
  reportError: mockReportError
}))

vi.mock(import('@sentry/vue'), () => ({
  addBreadcrumb: vi.fn()
}))

function requestFailure(status: number) {
  const error = new AxiosError(`Request failed with status code ${status}`)
  error.response = { status } as AxiosResponse
  return error
}

describe('bootstrapStore', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getCustomNodesI18n').mockResolvedValue({})
    vi.spyOn(i18nModule, 'mergeCustomNodesI18n').mockImplementation(() => {})
    useSettingStore().isReady = false
    useAuthStore().isInitialized = false
    Object.assign(useAuthStore(), { currentUser: null })
    Object.assign(useUserStore(), { needsLogin: false })
    mockDistributionTypes.isCloud = false
    vi.mocked(useSettingStore().load).mockImplementation(() => {
      useSettingStore().isReady = true
      return Promise.resolve()
    })
    vi.mocked(useWorkflowStore().loadWorkflows).mockResolvedValue(undefined)
    vi.mocked(useWorkflowStore().syncWorkflows).mockResolvedValue(undefined)
    vi.mocked(useUserStore().initialize).mockResolvedValue(undefined)
  })

  it('initializes with all flags false', () => {
    const store = useBootstrapStore()
    const settingStore = useSettingStore()
    expect(settingStore.isReady).toBe(false)
    expect(store.isI18nReady).toBe(false)
  })

  it('starts store bootstrap (settings, i18n)', async () => {
    const store = useBootstrapStore()
    const settingStore = useSettingStore()
    void store.startStoreBootstrap()

    await vi.waitFor(() => {
      expect(settingStore.isReady).toBe(true)
      expect(store.isI18nReady).toBe(true)
    })
  })

  it('exposes a failed prerequisite without rejecting and recovers on an explicit retry', async () => {
    const cause = new Error('User configuration unavailable')
    vi.mocked(useUserStore().initialize).mockRejectedValueOnce(cause)
    const store = useBootstrapStore()

    await expect(store.startStoreBootstrap()).resolves.toBeUndefined()

    expect(store.startupFailure).toEqual({ cause })
    expect(useSettingStore().isReady).toBe(false)
    expect(useSettingStore().load).not.toHaveBeenCalled()
    expect(mockReportError).toHaveBeenCalledExactlyOnceWith(cause, {
      surface: 'platform',
      errorType: 'failure_initializing_editor_stores'
    })

    await store.startStoreBootstrap()

    expect(store.startupFailure).toBeUndefined()
    expect(useSettingStore().isReady).toBe(true)
  })

  it('coalesces concurrent bootstrap requests while the prerequisite is pending', async () => {
    const prerequisite = Promise.withResolvers<void>()
    vi.mocked(useUserStore().initialize).mockReturnValueOnce(
      prerequisite.promise
    )
    const store = useBootstrapStore()
    const first = store.startStoreBootstrap()
    const second = store.startStoreBootstrap()
    expect(useUserStore().initialize).toHaveBeenCalledOnce()
    expect(useSettingStore().isReady).toBe(false)
    prerequisite.resolve()
    await Promise.all([first, second])
    expect(store.startupFailure).toBeUndefined()
    expect(useSettingStore().isReady).toBe(true)
  })

  it('shows startup failure when user-storage headers arrive but the body never completes', async () => {
    const client = new ComfyApi()
    let disposeBody: (() => void) | undefined
    vi.mocked(fetch).mockImplementationOnce((_input, init) => {
      const signal = init?.signal
      assert.exists(signal)
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const abortBody = () => {
            controller.error(signal.reason)
          }
          signal.addEventListener('abort', abortBody, { once: true })
          controller.enqueue(new TextEncoder().encode('{"storage":'))
          disposeBody = () => {
            signal.removeEventListener('abort', abortBody)
            controller.error(new DOMException('Test cleanup', 'AbortError'))
          }
        }
      })
      return Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })
    vi.mocked(useUserStore().initialize).mockImplementation(async () => {
      await client.getUserConfig()
    })
    const store = useBootstrapStore()
    const pending = store.startStoreBootstrap()
    try {
      await vi.advanceTimersByTimeAsync(60_000)
      expect(store.startupFailure).toMatchObject({
        cause: { name: 'TimeoutError' }
      })
      expect(useSettingStore().load).not.toHaveBeenCalled()
      expect(useWorkflowStore().loadWorkflows).not.toHaveBeenCalled()
      expect(mockReportError).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ name: 'TimeoutError' }),
        {
          surface: 'platform',
          errorType: 'failure_initializing_editor_stores'
        }
      )
    } finally {
      disposeBody?.()
      await pending
    }
  })

  it('records both store phases when their loads reject', async () => {
    vi.mocked(useSettingStore().load).mockRejectedValueOnce(
      new Error('settings failed')
    )
    vi.mocked(useWorkflowStore().loadWorkflows).mockRejectedValueOnce(
      new Error('workflows failed')
    )
    const milestone = vi.spyOn(bootstrapTracer, 'milestone')
    const previousPhaseCount = bootstrapTracer.summary().length
    const store = useBootstrapStore()

    await expect(store.startStoreBootstrap()).resolves.toBeUndefined()

    await vi.waitFor(() => {
      expect(milestone).toHaveBeenCalledWith('stores-ready')
      expect(store.isI18nReady).toBe(true)
    })
    const phaseRows = bootstrapTracer.summary().slice(previousPhaseCount)
    expect(phaseRows.map((row) => row.name)).toEqual(
      expect.arrayContaining(['bootstrap/settings', 'bootstrap/workflows'])
    )
  })

  describe('custom node translations', () => {
    it('treats a missing /api/i18n endpoint as no translations', async () => {
      vi.mocked(api.getCustomNodesI18n).mockRejectedValueOnce(
        requestFailure(404)
      )
      const store = useBootstrapStore()
      void store.startStoreBootstrap()

      await vi.waitFor(() => {
        expect(store.isI18nReady).toBe(true)
      })
      expect(store.i18nError).toBeUndefined()
      expect(mergeCustomNodesI18n).not.toHaveBeenCalled()
    })

    it('surfaces failures other than a missing endpoint', async () => {
      vi.mocked(api.getCustomNodesI18n).mockRejectedValueOnce(
        requestFailure(500)
      )
      const store = useBootstrapStore()
      void store.startStoreBootstrap()

      await vi.waitFor(() => {
        expect(store.i18nError).toBeDefined()
      })
      expect(store.isI18nReady).toBe(false)
    })
  })

  describe('cloud mode', () => {
    beforeEach(() => {
      mockDistributionTypes.isCloud = true
      mockReportError.mockReset()
    })

    it('waits for cookie identity before loading prepaid editor stores without a Firebase user', async () => {
      vi.stubEnv('VITE_RUN_BILLING_MODE', 'prepaid')
      useAuthStore().isInitialized = false
      const identityReady = Promise.withResolvers<void>()
      vi.mocked(bootCloudIdentity).mockReturnValueOnce(identityReady.promise)
      const startup = useBootstrapStore().startStoreBootstrap()
      await vi.waitFor(() => expect(bootCloudIdentity).toHaveBeenCalledOnce())
      expect(useSettingStore().isReady).toBe(false)
      expect(useWorkflowStore().loadWorkflows).not.toHaveBeenCalled()
      identityReady.resolve()
      await startup
      expect(useAuthStore().currentUser).toBeNull()
      expect(useSettingStore().isReady).toBe(true)
      expect(useWorkflowStore().loadWorkflows).toHaveBeenCalledOnce()
    })

    it('waits for Firebase init before loading stores, then resumes after sign-in', async () => {
      const store = useBootstrapStore()
      const settingStore = useSettingStore()
      const bootstrapPromise = store.startStoreBootstrap()

      expect(settingStore.isReady).toBe(false)

      await vi.waitFor(() => {
        expect(store.isI18nReady).toBe(true)
      })
      expect(useAuthStore().isInitialized).toBe(false)

      useAuthStore().isInitialized = true

      await vi.waitFor(() => {
        expect(store.isI18nReady).toBe(true)
      })
      expect(settingStore.isReady).toBe(false)
      expect(useWorkflowStore().loadWorkflows).not.toHaveBeenCalled()

      useAuthStore().currentUser = fromPartial({ uid: 'user-123' })
      await bootstrapPromise

      expect(settingStore.isReady).toBe(true)
    })

    it('boots the web session before waiting for a sign-in and loads stores for a session-only user', async () => {
      const boot = vi.mocked(bootCloudIdentity)
      const store = useBootstrapStore()
      const bootstrapPromise = store.startStoreBootstrap()
      await vi.waitFor(() => expect(store.isI18nReady).toBe(true))
      expect(boot).not.toHaveBeenCalled()

      useAuthStore().isInitialized = true
      await vi.waitFor(() => expect(boot).toHaveBeenCalledOnce())
      expect(useSettingStore().isReady).toBe(false)

      Object.assign(useCloudWebSessionStore(), {
        state: {
          phase: 'signed_in',
          session: fromPartial<WebSession>({ user: { id: 'user-a' } })
        }
      })
      await bootstrapPromise

      expect(useSettingStore().isReady).toBe(true)
    })

    it('retries once and keeps authenticated stores gated if Firebase resolves signed out', async () => {
      vi.useFakeTimers()
      try {
        const store = useBootstrapStore()
        const settingStore = useSettingStore()
        void store.startStoreBootstrap()

        // First wait times out with Firebase still not initialized.
        await vi.advanceTimersByTimeAsync(16_001)
        expect(settingStore.isReady).toBe(false)

        // Firebase resolves during the retry backoff.
        useAuthStore().isInitialized = true
        await vi.advanceTimersByTimeAsync(3_001)

        expect(settingStore.isReady).toBe(false)
        expect(mockReportError).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('gives up after a second timeout, reports it, and keeps authenticated stores gated', async () => {
      vi.useFakeTimers()
      try {
        const store = useBootstrapStore()
        const settingStore = useSettingStore()
        void store.startStoreBootstrap()

        // Firebase never resolves through the initial wait, the backoff, or the retry.
        await vi.advanceTimersByTimeAsync(16_000 + 3_000 + 16_001)

        expect(mockReportError).toHaveBeenCalledOnce()
        expect(mockReportError).toHaveBeenCalledWith(expect.anything(), {
          surface: 'platform',
          errorType: 'bootstrap_auth_wait_timeout'
        })
        expect(console.error).not.toHaveBeenCalled()
        expect(settingStore.isReady).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
