import { expect, it, vi } from 'vitest'

import { ComfyApi } from '@/scripts/api'
import { reportError } from '@/platform/telemetry/reportError'

vi.mock(import('@/platform/telemetry/reportError'))

it.for([
  { folder: 'LLM/Qwen', encoded: 'LLM%2FQwen' },
  {
    folder: 'LLM/中文 100%2F',
    encoded: 'LLM%2F%E4%B8%AD%E6%96%87%20100%252F'
  }
])(
  'preserves exact catalogue paths for $folder',
  async ({ folder, encoded }) => {
    const client = new ComfyApi()
    const filename = 'nested/模型 100%.safetensors'
    const files = [{ name: filename, pathIndex: 0 }]
    const metadata = { 'modelspec.title': 'Catalogue model' }
    const request = vi
      .spyOn(client, 'fetchApi')
      .mockResolvedValueOnce(Response.json(files))
      .mockResolvedValueOnce(Response.json(metadata))

    await expect(client.getModels(folder)).resolves.toEqual(files)
    await expect(client.viewMetadata(folder, filename)).resolves.toEqual(
      metadata
    )

    expect(request).toHaveBeenCalledWith(`/experiment/models/${encoded}`)
    expect(request).toHaveBeenCalledWith(
      `/view_metadata/${encoded}?filename=nested%2F%E6%A8%A1%E5%9E%8B%20100%25.safetensors`
    )
  }
)

it('preserves validated model-folder extension allowlists', async () => {
  const client = new ComfyApi()
  vi.spyOn(client, 'fetchApi').mockResolvedValue(
    Response.json([
      {
        name: 'LLM/Qwen',
        folders: ['LLM/Qwen'],
        extensions: ['.gguf', '.onnx']
      },
      { name: 'configs', folders: ['configs'], extensions: [] }
    ])
  )

  await expect(client.getModelFolders()).resolves.toEqual([
    {
      name: 'LLM/Qwen',
      folders: ['LLM/Qwen'],
      extensions: ['.gguf', '.onnx']
    }
  ])
})

it.for([
  { name: 'bad folders', body: [{ name: 'checkpoints', folders: 'models' }] },
  {
    name: 'bad extensions',
    body: [{ name: 'checkpoints', folders: ['models'], extensions: [42] }]
  }
])('rejects model-folder responses with $name', async ({ body }) => {
  const client = new ComfyApi()
  vi.spyOn(client, 'fetchApi').mockResolvedValue(Response.json(body))

  await expect(client.getModelFolders()).rejects.toThrow()
})

it('rejects malformed model-file responses', async () => {
  const client = new ComfyApi()
  vi.spyOn(client, 'fetchApi').mockResolvedValue(
    Response.json([{ name: 'model.safetensors', pathIndex: '0' }])
  )

  await expect(client.getModels('checkpoints')).rejects.toThrow()
})

it.for([
  { name: 'unauthenticated', status: 401, body: '{"error":"Unauthorized"}' },
  { name: 'unavailable', status: 503, body: '{"error":"Unavailable"}' },
  { name: 'malformed JSON', status: 200, body: '{' },
  { name: 'array', status: 200, body: '[]' },
  { name: 'non-string metadata', status: 200, body: '{"tags":123}' }
])('does not cache $name as model metadata', async ({ status, body }) => {
  const client = new ComfyApi()
  vi.spyOn(client, 'fetchApi').mockResolvedValueOnce(
    new Response(body, { status })
  )

  await expect(
    client.viewMetadata('checkpoints', 'model.safetensors')
  ).resolves.toBeNull()
  expect(reportError).toHaveBeenCalledExactlyOnceWith(
    expect.any(Error),
    expect.objectContaining({
      errorType: 'error_loading_model_metadata',
      surface: 'assets'
    })
  )
})

it.for([{}, { title: 'Model', description: null }])(
  'accepts valid metadata %j',
  async (metadata) => {
    const client = new ComfyApi()
    vi.spyOn(client, 'fetchApi').mockResolvedValueOnce(Response.json(metadata))

    await expect(
      client.viewMetadata('checkpoints', 'model.safetensors')
    ).resolves.toEqual(metadata)
  }
)
