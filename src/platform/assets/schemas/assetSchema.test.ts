import { expect, it } from 'vitest'

import { assetResponseSchema } from './assetSchema'

const asset = {
  id: 'upl_source',
  name: 'scene.glb',
  tags: ['input'],
  created_at: '2026-10-16T00:00:00Z',
  updated_at: '2026-10-16T00:00:00Z'
}

it.for([
  '07232be0-e6d7-4433-9f3c-e2dff9d1bebd',
  'upl_saved_thumbnail',
  null,
  undefined
])('keeps an asset list usable with preview reference %s', (previewId) => {
  const result = assetResponseSchema.parse({
    assets: [{ ...asset, preview_id: previewId }],
    total: 1,
    has_more: false,
    next_cursor: ''
  })

  expect(result.assets[0]?.id).toBe('upl_source')
  expect(result.assets[0]?.preview_id).toBe(previewId)
})

it.for([123, false, { id: 'upl_saved_thumbnail' }])(
  'rejects a non-identifier preview reference %s',
  (previewId) => {
    expect(
      assetResponseSchema.safeParse({
        assets: [{ ...asset, preview_id: previewId }],
        total: 1,
        has_more: false,
        next_cursor: ''
      }).success
    ).toBe(false)
  }
)
