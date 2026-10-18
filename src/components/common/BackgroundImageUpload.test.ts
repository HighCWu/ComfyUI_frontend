import { render, screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createI18n } from 'vue-i18n'
import { describe, expect, it, vi } from 'vitest'

import { useToast } from '@/components/ui/toast/toastStore'
import en from '@/locales/en/main.json'
import { api } from '@/scripts/api'

import BackgroundImageUpload from './BackgroundImageUpload.vue'

vi.mock(import('@/scripts/api'))

describe('BackgroundImageUpload', () => {
  it('does not adopt a malformed upload response', async () => {
    vi.mocked(api.fetchApi).mockResolvedValue(
      Response.json({ name: 42, subfolder: 'backgrounds' })
    )
    const update = vi.fn()
    render(BackgroundImageUpload, {
      props: {
        modelValue: 'existing.png',
        'onUpdate:modelValue': update
      },
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })]
      }
    })
    const input = screen.getByLabelText(en.g.upload, { selector: 'input' })

    await userEvent.upload(
      input,
      new File(['image'], 'background.png', { type: 'image/png' })
    )

    await waitFor(() => expect(api.fetchApi).toHaveBeenCalledOnce())
    expect(update).not.toHaveBeenCalled()
    expect(useToast().warning).toHaveBeenCalledOnce()
  })
})
