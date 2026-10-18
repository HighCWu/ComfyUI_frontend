import { describe, expect, it, onTestFinished } from 'vitest'

import {
  appendEditorSession,
  editorSessionFromNavigation,
  updateEditorSessionNavigation
} from '@/scripts/editorSessionUrl'

describe('appendEditorSession', () => {
  it('appends an editor session to an API URL', () => {
    expect(appendEditorSession('/api/object_info', 'eds_instance-one')).toBe(
      '/api/object_info?client_id=eds_instance-one'
    )
  })

  it('preserves existing query parameters', () => {
    expect(
      appendEditorSession('/api/view?filename=image.png', 'eds_instance-two')
    ).toBe('/api/view?filename=image.png&client_id=eds_instance-two')
  })

  it('leaves URLs unchanged outside an editor session', () => {
    expect(appendEditorSession('/api/object_info', 'ordinary-window')).toBe(
      '/api/object_info'
    )
  })

  it.for([
    '/api/object_info?client_id=eds_current',
    '/api/object_info?client_id=eds_old',
    '/api/object_info?client_id=eds_old&client_id=eds_other'
  ])('keeps one current binding when wrapping %s', (url) => {
    expect(appendEditorSession(url, 'eds_current')).toBe(
      '/api/object_info?client_id=eds_current'
    )
  })

  it('preserves unrelated query values and the fragment', () => {
    const url = appendEditorSession(
      '/api/view?filename=a%2Bb.png&client_id=eds_old#preview',
      'eds_current'
    )
    expect(url).toBe(
      '/api/view?filename=a%2Bb.png&client_id=eds_current#preview'
    )
    expect(appendEditorSession(url, 'eds_current')).toBe(url)
  })
})

describe('editorSessionFromNavigation', () => {
  it('restores the exact editor binding when opening a top-level link', () => {
    expect(
      editorSessionFromNavigation('?client_id=eds_exact-plan&share=shr_one')
    ).toBe('eds_exact-plan')
  })

  it.for([
    '',
    '?client_id=ordinary',
    '?client_id=eds_',
    '?client_id=eds_one&client_id=eds_two',
    '?client_id=eds_%2Fforeign',
    `?client_id=eds_${'a'.repeat(125)}`
  ])('does not accept invalid or ambiguous navigation: %s', (query) => {
    expect(editorSessionFromNavigation(query)).toBeNull()
  })
})

it('removes a previous-account URL binding without losing the share', () => {
  const previousUrl = window.location.href
  window.history.replaceState({}, '', '/comfy/?client_id=eds_old&share=shr_one')
  onTestFinished(() => window.history.replaceState({}, '', previousUrl))
  updateEditorSessionNavigation('')
  expect(window.location.pathname + window.location.search).toBe(
    '/comfy/?share=shr_one'
  )
})
