import { expect, it, vi } from 'vitest'

import { useFeatureFlags } from '@/composables/useFeatureFlags'
import { useDialogStore } from '@/stores/dialogStore'

import { useModelUpload } from './useModelUpload'

vi.mock(import('@/composables/useFeatureFlags'))

it.for([true, false])(
  'opens managed model uploads only when advertised by the server (%s)',
  (enabled) => {
    vi.stubEnv('VITE_RUN_BILLING_MODE', 'prepaid')
    vi.mocked(useFeatureFlags().flags).modelUploadButtonEnabled = enabled
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const showDialog = vi.spyOn(useDialogStore(), 'showDialog')
    const upload = useModelUpload()
    expect(upload.isUploadButtonEnabled.value).toBe(enabled)
    upload.showUploadDialog()
    expect(open.mock.calls).toEqual(
      enabled ? [['/models/upload', '_blank', 'noopener,noreferrer']] : []
    )
    expect(showDialog).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  }
)

it.for([
  { privateModels: false, dialog: 'upload-model-upgrade' },
  { privateModels: true, dialog: 'upload-model' }
])(
  'preserves the upstream dialog outside prepaid mode ($dialog)',
  ({ privateModels, dialog }) => {
    vi.stubEnv('VITE_RUN_BILLING_MODE', undefined)
    vi.mocked(useFeatureFlags().flags).privateModelsEnabled = privateModels
    const showDialog = vi.spyOn(useDialogStore(), 'showDialog')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    useModelUpload().showUploadDialog()
    expect(showDialog).toHaveBeenCalledWith(
      expect.objectContaining({ key: dialog })
    )
    expect(open).not.toHaveBeenCalled()
  }
)
