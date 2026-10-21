import userEvent from '@testing-library/user-event'
import { render, screen } from '@testing-library/vue'
import { expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'
import { api } from '@/scripts/api'
import { useCommandStore } from '@/stores/commandStore'
import { useQueueSettingsStore } from '@/stores/queueSettingsStore'
import { defineComponent, h } from 'vue'

vi.mock(import('firebase/auth'))
vi.mock(import('@/composables/billing/useBillingContext'))
vi.mock(import('@/composables/useFeatureFlags'))
vi.mock(import('@/composables/useErrorHandling'))
vi.mock(import('@/platform/workspace/composables/useWorkspaceUI'))
vi.mock(import('@/services/dialogService'))
vi.mock(import('@/platform/distribution/types'), () => ({ isCloud: true }))
vi.mock(import('@/platform/telemetry'))

vi.stubEnv('VITE_RUN_BILLING_MODE', 'prepaid')
await import('./CloudRunButtonWrapper.vue')
const { default: RunButton } = await import('./index')
const RunSurface = defineComponent(() => () => h(RunButton))

it('keeps native Run immediate and unchanged while the strategy reference is pending', async () => {
  vi.stubEnv('VITE_RUN_BILLING_MODE', 'prepaid')
  vi.spyOn(api, 'fetchApi').mockReturnValue(new Promise(() => {}))
  vi.mocked(useCommandStore().execute).mockResolvedValue(undefined)
  render(RunSurface, { global: { plugins: [i18n] } })
  const user = userEvent.setup()
  expect(await screen.findByTestId('queue-button')).toHaveTextContent(/^Run$/)
  expect(screen.getByRole('button', { name: 'Run strategy' })).toBeVisible()
  expect(screen.getByTestId('queue-mode-menu-trigger')).toBeVisible()
  await user.click(screen.getByTestId('queue-button'))
  expect(useCommandStore().execute).toHaveBeenCalledExactlyOnceWith(
    'Comfy.QueuePrompt',
    {
      metadata: { subscribe_to_run: false, trigger_source: 'button' }
    }
  )
  expect(api.fetchApi).toHaveBeenCalledExactlyOnceWith(
    '/run-strategies',
    expect.any(Object)
  )
})

it('preserves the original mode menu and permits leaving a previously saved automatic mode', async () => {
  vi.stubEnv('VITE_RUN_BILLING_MODE', 'prepaid')
  vi.spyOn(api, 'fetchApi').mockResolvedValue(
    new Response(null, { status: 503 })
  )
  useQueueSettingsStore().mode = 'change'
  render(RunSurface, { global: { plugins: [i18n] } })
  const user = userEvent.setup()
  const menu = await screen.findByTestId('queue-mode-menu-trigger')
  await user.hover(screen.getByTestId('queue-button'))
  expect(
    await screen.findByRole('dialog', { name: 'Run strategy' })
  ).toBeVisible()
  await user.click(menu)
  expect(screen.queryByRole('dialog', { name: 'Run strategy' })).toBeNull()
  await user.click(screen.getByRole('menuitemradio', { name: /^Run$/ }))
  expect(useQueueSettingsStore().mode).toBe('disabled')
  expect(screen.getByTestId('queue-button')).toHaveTextContent(/^Run$/)
  expect(useCommandStore().execute).not.toHaveBeenCalled()
})
