import { describe, expect, it } from 'vitest'

import { appendEditorSession } from '@/scripts/editorSessionUrl'

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
})
