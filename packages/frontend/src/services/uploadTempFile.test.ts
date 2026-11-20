import { describe, expect, it, vi } from 'vitest'

import { useToast } from '@/components/ui/toast/toastStore'
import { t } from '@/i18n'
import { api } from '@/scripts/api'

import { uploadTempFile } from './uploadTempFile'

vi.mock(import('@/i18n'))
vi.mock(import('@/scripts/api'))

describe('uploadTempFile', () => {
  it('returns a validated temporary file reference', async () => {
    vi.mocked(api.fetchApi).mockResolvedValue(
      Response.json({
        name: 'capture.png',
        subfolder: 'webcam',
        type: 'temp'
      })
    )

    const result = await uploadTempFile(
      new File(['image'], 'capture.png'),
      'webcam'
    )

    expect(result).toEqual({
      ok: true,
      file: {
        name: 'capture.png',
        subfolder: 'webcam',
        type: 'temp'
      }
    })
  })

  it('returns a failure for a malformed success response', async () => {
    vi.mocked(api.fetchApi).mockResolvedValue(
      Response.json({ name: 42, subfolder: 'webcam', type: 'temp' })
    )

    const result = await uploadTempFile(
      new File(['image'], 'capture.png'),
      'webcam'
    )

    expect(result).toEqual({
      ok: false,
      reason: 'Invalid upload response'
    })
    expect(t).toHaveBeenCalledWith('g.uploadFailed', {
      reason: 'Invalid upload response'
    })
    expect(useToast().warning).toHaveBeenCalledWith('g.uploadFailed')
  })
})
