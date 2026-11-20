import axios from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearCatalogueReaderPorts,
  installCatalogueReaderPorts
} from '@/extensions/core/domonCatalogueReaderPorts'
import type { CatalogueReaderPorts } from '@/extensions/core/domonCatalogueReaderPorts'
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

describe('ComfyApi.getCoreWorkflowTemplates with catalogue reader ports', () => {
  afterEach(() => {
    clearCatalogueReaderPorts()
  })

  function buildReader(
    overrides: Partial<CatalogueReaderPorts> = {}
  ): CatalogueReaderPorts {
    return {
      version: 'domon-comfy-catalogue-readers/v1',
      readerId: 'host-reader',
      readCoreWorkflowTemplates: vi.fn(async () => [
        {
          moduleName: 'host',
          category: 'Host',
          title: 'Host',
          templates: []
        }
      ]),
      ...overrides
    }
  }

  it('serves the core template index through the installed reader without touching the pinned endpoint', async () => {
    const reader = buildReader()
    installCatalogueReaderPorts(reader)
    const client = new ComfyApi()

    await expect(client.getCoreWorkflowTemplates('zh')).resolves.toEqual([
      { moduleName: 'host', category: 'Host', title: 'Host', templates: [] }
    ])
    expect(reader.readCoreWorkflowTemplates).toHaveBeenCalledWith('zh')
    expect(axios.get).not.toHaveBeenCalled()
  })

  it('revalidates reader payloads against the original core template schema', async () => {
    installCatalogueReaderPorts(
      buildReader({
        readCoreWorkflowTemplates: vi.fn(async () => ({ nope: true }))
      })
    )
    const client = new ComfyApi()

    await expect(client.getCoreWorkflowTemplates()).rejects.toThrow()
    expect(axios.get).not.toHaveBeenCalled()
  })

  it('propagates reader failures without the locale fallback chain', async () => {
    installCatalogueReaderPorts(
      buildReader({
        readCoreWorkflowTemplates: vi.fn(async () => {
          throw new Error('reader offline')
        })
      })
    )
    const client = new ComfyApi()

    await expect(client.getCoreWorkflowTemplates('fr')).rejects.toThrow(
      'reader offline'
    )
    expect(axios.get).not.toHaveBeenCalled()
  })

  it('fails honestly when the installed reader lacks the core template hook', async () => {
    installCatalogueReaderPorts(
      buildReader({ readCoreWorkflowTemplates: undefined })
    )
    const client = new ComfyApi()

    await expect(client.getCoreWorkflowTemplates()).rejects.toThrow(
      /Invalid input/
    )
    expect(axios.get).not.toHaveBeenCalled()
  })

  it('restores the pinned endpoint path after the reader is cleared', async () => {
    installCatalogueReaderPorts(buildReader())
    clearCatalogueReaderPorts()
    const client = new ComfyApi()
    const templates = [
      {
        moduleName: 'default',
        category: 'Foundation',
        title: 'Image',
        templates: []
      }
    ]
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: templates,
      headers: { 'content-type': 'application/json' }
    })

    await expect(client.getCoreWorkflowTemplates()).resolves.toEqual(templates)
    expect(axios.get).toHaveBeenCalledTimes(1)
  })
})
