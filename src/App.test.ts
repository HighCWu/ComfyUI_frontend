import { ZIndex } from '@primeuix/utils/zindex'
import { render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import userEvent from '@testing-library/user-event'

import { vRekaZIndex } from '@/components/dialog/vRekaZIndex'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useBootstrapStore } from '@/stores/bootstrapStore'
import { i18n } from '@/i18n'

import App from './App.vue'

vi.mock(import('firebase/auth'))

vi.mock<unknown>(import('@/components/dialog/GlobalDialog.vue'), () => ({
  default: { template: '<div />' }
}))
vi.mock<unknown>(import('@/scripts/app'), () => ({ app: {} }))
vi.mock<unknown>(
  import('@/workbench/extensions/manager/composables/useConflictDetection'),
  () => ({
    useConflictDetection: () => ({
      initializeConflictDetection: vi.fn()
    })
  })
)

describe('App', () => {
  it('shows a recoverable startup failure even before the route or spinner has started', async () => {
    const reload = vi
      .spyOn(window.location, 'reload')
      .mockImplementation(() => {})
    const splash = document.createElement('div')
    splash.id = 'splash-loader'
    splash.dataset.testid = 'synthetic-splash'
    document.body.append(splash)
    useBootstrapStore().startupFailure = {
      cause: new Error('Synthetic startup failure')
    }
    useWorkspaceStore().spinner = true
    render(App, { global: { plugins: [i18n], stubs: { RouterView: true } } })
    await nextTick()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The editor could not start'
    )
    expect(screen.queryByTestId('synthetic-splash')).not.toBeInTheDocument()
    expect(screen.getByTestId('app-loading-overlay')).not.toBeVisible()
    expect(reload).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Reload editor' }))
    expect(reload).toHaveBeenCalledOnce()
  })

  it('blocks existing dialogs while loading and keeps a stable readiness hook', async () => {
    const workspaceStore = useWorkspaceStore()
    workspaceStore.spinner = true
    render({
      directives: { rekaZIndex: vRekaZIndex },
      template: '<div v-reka-z-index data-testid="dialog" />'
    })
    const dialog = screen.getByTestId('dialog')
    const { unmount } = render(App, {
      global: {
        stubs: { RouterView: true }
      }
    })
    await nextTick()

    const overlay = screen.getByTestId('app-loading-overlay')
    expect(overlay).toHaveAttribute('aria-busy', 'true')
    expect(overlay).toBeVisible()
    expect(ZIndex.get(overlay)).toBeGreaterThan(ZIndex.get(dialog))

    workspaceStore.spinner = false
    await nextTick()

    expect(screen.getByTestId('app-loading-overlay')).toBe(overlay)
    expect(overlay).toHaveAttribute('aria-busy', 'false')
    expect(overlay).not.toBeVisible()
    expect(ZIndex.get(overlay)).toBe(0)

    workspaceStore.spinner = true
    await nextTick()

    expect(overlay).toBeVisible()
    expect(ZIndex.get(overlay)).toBeGreaterThan(ZIndex.get(dialog))
    unmount()
    expect(ZIndex.get(overlay)).toBe(0)
  })
})
