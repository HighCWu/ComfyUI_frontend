import { expect, it, onTestFinished, vi } from 'vitest'

import { ComfyApi } from '@/scripts/api'

vi.mock(import('@/platform/distribution/types'), () => ({ isCloud: true }))

it('restores a top-level link binding before generating its first API request', () => {
  const previousUrl = window.location.href
  const previousName = window.name
  window.history.replaceState({}, '', '/comfy/?client_id=eds_exact-plan')
  window.name = ''
  onTestFinished(() => {
    window.history.replaceState({}, '', previousUrl)
    window.name = previousName
  })
  const client = new ComfyApi()
  expect(window.name).toBe('eds_exact-plan')
  expect(client.apiURL('')).toBe('/api')
  expect(client.apiURL('/object_info')).toBe(
    '/api/object_info?client_id=eds_exact-plan'
  )
  expect(client.internalURL('/models')).toBe(
    '/internal/models?client_id=eds_exact-plan'
  )
})
