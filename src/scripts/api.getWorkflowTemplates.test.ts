import axios from 'axios'
import { describe, expect, it, vi } from 'vitest'

import { ComfyApi } from '@/scripts/api'

vi.mock(import('axios'))

describe('ComfyApi.getWorkflowTemplates', () => {
  it('returns custom-node template groups from the generated response boundary', async () => {
    const client = new ComfyApi()
    vi.spyOn(client, 'fetchApi').mockResolvedValue(
      Response.json({ CustomNodePack: ['portrait', 'upscale'] })
    )

    await expect(client.getWorkflowTemplates()).resolves.toEqual({
      CustomNodePack: ['portrait', 'upscale']
    })
  })

  it.for([
    [],
    { CustomNodePack: 'portrait' },
    { CustomNodePack: ['portrait', 42] }
  ])('rejects a malformed template index: %j', async (body) => {
    const client = new ComfyApi()
    vi.spyOn(client, 'fetchApi').mockResolvedValue(Response.json(body))

    await expect(client.getWorkflowTemplates()).rejects.toThrow()
  })

  it('returns a valid pinned core template index with extension fields', async () => {
    const client = new ComfyApi()
    const templates = [
      {
        moduleName: 'default',
        category: 'Foundation',
        title: 'Image',
        templates: [
          {
            name: 'image_flux',
            title: 'Flux',
            description: 'Generate an image',
            mediaType: 'image',
            mediaSubtype: 'webp',
            openSource: true
          }
        ]
      }
    ]
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: templates,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    })

    await expect(client.getCoreWorkflowTemplates()).resolves.toEqual(templates)
  })

  it.for([
    {},
    [{ title: 'Image', templates: [] }],
    [{ moduleName: 'default', title: 'Image', templates: {} }],
    [
      {
        moduleName: 'default',
        title: 'Image',
        templates: [{ name: 'image_flux' }]
      }
    ]
  ])('drops a malformed pinned core template index: %j', async (body) => {
    const client = new ComfyApi()
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: body,
      headers: { 'content-type': 'application/json' }
    })

    await expect(client.getCoreWorkflowTemplates()).resolves.toEqual([])
  })
})
