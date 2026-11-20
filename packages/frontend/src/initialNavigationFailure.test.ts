import { render, screen } from '@testing-library/vue'
import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it, onTestFinished, vi } from 'vitest'
import { nextTick } from 'vue'

import App from '@/App.vue'
import { i18n } from '@/i18n'
import { bootCloudIdentity } from '@/platform/auth/session/cloudIdentityBoot'
import { useSettingStore } from '@/platform/settings/settingStore'
import { useWorkflowStore } from '@/platform/workflow/management/stores/workflowStore'
import router from '@/router'
import { api } from '@/scripts/api'
import type * as AppModule from '@/scripts/app'
import { useBootstrapStore } from '@/stores/bootstrapStore'
import { useUserStore } from '@/stores/userStore'
import { useConflictDetection } from '@/workbench/extensions/manager/composables/useConflictDetection'

vi.mock(import('firebase/auth'))
vi.mock(import('@/platform/auth/session/cloudIdentityBoot'))
vi.mock(import('@/scripts/app'), () =>
  fromPartial<typeof AppModule>({ app: {} })
)
vi.mock(
  import('@/workbench/extensions/manager/composables/useConflictDetection')
)

const distribution = vi.hoisted(() => ({
  DISTRIBUTION: 'localhost' as const,
  isCloud: false,
  isDesktop: false,
  isNightly: false
}))
vi.mock(import('@/platform/distribution/types'), () => distribution)
const reportError = vi.hoisted(() => vi.fn())
vi.mock(import('@/platform/telemetry/reportError'), () => ({ reportError }))

it('keeps an initial route failure visible when later bootstrap loads the same user successfully', async () => {
  vi.mocked(useConflictDetection).mockReturnValue(
    fromPartial({ initializeConflictDetection: vi.fn() })
  )
  vi.stubEnv('VITE_RUN_BILLING_MODE', 'prepaid')
  distribution.isCloud = true
  onTestFinished(() => {
    distribution.isCloud = false
  })
  const identity = Promise.withResolvers<void>()
  vi.mocked(bootCloudIdentity).mockReturnValue(identity.promise)
  const firstRead =
    Promise.withResolvers<Awaited<ReturnType<typeof api.getUserConfig>>>()
  const reading = Promise.withResolvers<void>()
  const configuration = vi
    .spyOn(api, 'getUserConfig')
    .mockImplementationOnce(() => {
      reading.resolve()
      return firstRead.promise
    })
    .mockResolvedValue({ storage: 'server', migrated: true })
  vi.spyOn(api, 'getCustomNodesI18n').mockResolvedValue({})
  vi.mocked(useSettingStore().load).mockResolvedValue(undefined)
  vi.mocked(useWorkflowStore().loadWorkflows).mockResolvedValue(undefined)
  const splash = document.createElement('div')
  splash.id = 'splash-loader'
  splash.dataset.testid = 'initial-route-splash'
  document.body.append(splash)
  const { unmount } = render(App, { global: { plugins: [router, i18n] } })
  const routeReady = router.isReady().catch((cause: unknown) => cause)
  const bootstrap = useBootstrapStore()
  const boot = bootstrap.startStoreBootstrap()
  onTestFinished(async () => {
    identity.resolve()
    await boot
    unmount()
  })
  await reading.promise
  const cause = new SyntaxError('Incomplete user configuration JSON')
  firstRead.reject(cause)
  await expect(routeReady).resolves.toBe(cause)
  await nextTick()
  expect(screen.getByRole('alert')).toHaveTextContent(
    'The editor could not start'
  )
  expect(screen.queryByTestId('initial-route-splash')).not.toBeInTheDocument()
  identity.resolve()
  await boot
  expect(configuration).toHaveBeenCalledTimes(2)
  expect(useUserStore().initialized).toBe(true)
  expect(bootstrap.startupFailure).toEqual({ cause })
  expect(screen.getByRole('alert')).toBeVisible()
  expect(reportError).toHaveBeenCalledExactlyOnceWith(cause, {
    surface: 'platform',
    errorType: 'failure_initializing_editor_stores'
  })
  const removeReady = router.addRoute({
    path: '/__startup-ready',
    component: { template: '<div />' }
  })
  const laterCause = new Error('Later navigation failed')
  const removeFailure = router.addRoute({
    path: '/__startup-later-failure',
    component: { template: '<div />' },
    beforeEnter: () => {
      throw laterCause
    }
  })
  onTestFinished(() => {
    removeReady()
    removeFailure()
  })
  await router.push('/__startup-ready')
  await expect(router.push('/__startup-later-failure')).rejects.toBe(laterCause)
  expect(bootstrap.startupFailure).toEqual({ cause })
  expect(reportError).toHaveBeenCalledTimes(1)
  expect(console.error).toHaveBeenCalledWith(laterCause)
})
