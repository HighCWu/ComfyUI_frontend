import { describe, expect, it, vi } from 'vitest'

import { api } from '@/scripts/api'

import { fetchNodeReplacements } from './nodeReplacementService'

vi.mock(import('@/scripts/api'))

const replacement = {
  new_node_id: 'ImageScaleToMaxDimension',
  old_node_id: 'ResizeImagesByLongerEdge',
  old_widget_ids: ['longer_edge'],
  input_mapping: [
    { new_id: 'image', old_id: 'images' },
    { new_id: 'upscale_method', set_value: 'lanczos' }
  ],
  output_mapping: [{ new_idx: 0, old_idx: 0 }]
}

describe('fetchNodeReplacements', () => {
  it('returns a validated replacement map', async () => {
    vi.mocked(api.fetchApi).mockResolvedValue(
      Response.json({ ResizeImagesByLongerEdge: [replacement] })
    )

    await expect(fetchNodeReplacements()).resolves.toEqual({
      ResizeImagesByLongerEdge: [replacement]
    })
  })

  it('rejects a malformed replacement map', async () => {
    vi.mocked(api.fetchApi).mockResolvedValue(
      Response.json({
        ResizeImagesByLongerEdge: [
          { ...replacement, output_mapping: [{ new_idx: '0', old_idx: 0 }] }
        ]
      })
    )

    await expect(fetchNodeReplacements()).rejects.toThrow()
  })
})
