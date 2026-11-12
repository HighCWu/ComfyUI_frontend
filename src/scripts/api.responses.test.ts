import { assert, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { fromAny } from '@total-typescript/shoehorn'

import type { WorkflowApiAssetsResponse } from '@comfyorg/ingest-types'
import axios from 'axios'
import type {
  PromptFailureResponse,
  PromptResponse
} from '@/platform/remote/comfyui/types'
import type { ComfyWorkflowJSON } from '@/platform/workflow/validation/schemas/workflowSchema'
import { api, ComfyApi, PromptExecutionError } from '@/scripts/api'

describe('ComfyApi response boundaries', () => {
  it('models prompt success separately from prompt failure', () => {
    const success = { prompt_id: 'job-17' } satisfies PromptResponse
    const failure = {
      error: {
        type: 'prompt_outputs_failed_validation',
        message: 'Prompt outputs failed validation',
        details: ''
      }
    } satisfies PromptFailureResponse

    expectTypeOf(success).toExtend<PromptResponse>()
    expectTypeOf<PromptResponse>().not.toHaveProperty('error')
    expect(new PromptExecutionError(failure).response).toEqual(failure)
  })

  it('formats prompt failures without a nested error', () => {
    expect(
      new PromptExecutionError({
        message: 'Gateway rejected prompt'
      }).toString()
    ).toBe('Gateway rejected prompt')
  })

  it('validates a successful prompt submission before returning it', async () => {
    const client = new ComfyApi()
    const promptId = crypto.randomUUID()
    vi.spyOn(client, 'fetchApi').mockResolvedValue(
      Response.json({
        prompt_id: promptId,
        number: 17,
        node_errors: {},
        execution_kind: 'gpu'
      })
    )

    await expect(
      client.queuePrompt(0, {
        output: {},
        workflow: fromAny<ComfyWorkflowJSON, unknown>({})
      })
    ).resolves.toMatchObject({
      prompt_id: promptId,
      number: 17,
      execution_kind: 'gpu'
    })
  })

  it('rejects a malformed successful prompt submission', async () => {
    const client = new ComfyApi()
    vi.spyOn(client, 'fetchApi').mockResolvedValue(
      Response.json({ prompt_id: 'not-a-uuid', node_errors: [] })
    )

    await expect(
      client.queuePrompt(0, {
        output: {},
        workflow: fromAny<ComfyWorkflowJSON, unknown>({})
      })
    ).rejects.toThrow()
  })

  it('validates node definitions while preserving extension metadata', async () => {
    const client = new ComfyApi()
    const response = {
      ExampleNode: {
        name: 'ExampleNode',
        display_name: 'Example node',
        category: 'examples',
        input: { required: { text: ['STRING'] } },
        output: ['IMAGE'],
        custom_extension_metadata: { package: 'example-pack' }
      }
    }
    vi.spyOn(client, 'fetchApi').mockResolvedValue(Response.json(response))

    await expect(client.getNodeDefs()).resolves.toEqual(response)
  })

  it('accepts legacy node metadata present in the staging object catalog', async () => {
    const client = new ComfyApi()
    const response = {
      LegacyNode: {
        name: 'LegacyNode',
        display_name: null,
        output: [['first', 'second']],
        output_is_list: [null],
        output_name: 'CHOICE',
        output_tooltips: [null]
      }
    }
    vi.spyOn(client, 'fetchApi').mockResolvedValue(Response.json(response))

    await expect(client.getNodeDefs()).resolves.toEqual(response)
  })

  it.for([null, [], { BrokenNode: null }, { BrokenNode: 'invalid' }])(
    'rejects malformed node definitions %#',
    async (response) => {
      const client = new ComfyApi()
      vi.spyOn(client, 'fetchApi').mockResolvedValue(Response.json(response))

      await expect(client.getNodeDefs()).rejects.toThrow()
    }
  )

  it('validates system stats while preserving Laimon extensions', async () => {
    const client = new ComfyApi()
    const response = {
      system: {
        argv: [],
        comfyui_version: '0.3.76',
        embedded_python: false,
        os: 'cloud',
        python_version: 'n/a',
        pytorch_version: 'n/a',
        ram_free: 0,
        ram_total: 0,
        required_frontend_version: '1.58.0'
      },
      devices: [],
      telemetry: { scope: 'control-plane', available: false }
    }
    vi.spyOn(client, 'fetchApi').mockResolvedValue(Response.json(response))

    await expect(client.getSystemStats()).resolves.toEqual(response)
  })

  it('rejects malformed system stats before they reach the store', async () => {
    const client = new ComfyApi()
    vi.spyOn(client, 'fetchApi').mockResolvedValue(
      Response.json({ system: { os: 'cloud' }, devices: 'none' })
    )

    await expect(client.getSystemStats()).rejects.toThrow()
  })

  it('validates the native user-storage bootstrap while preserving extensions', async () => {
    const client = new ComfyApi()
    const response = {
      storage: 'server',
      migrated: true,
      deployment: 'laimon'
    }
    vi.mocked(fetch).mockResolvedValue(Response.json(response))

    await expect(client.getUserConfig()).resolves.toEqual(response)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.for([{ headerDelay: 0 }, { headerDelay: 59_000 }])(
    'bounds an unfinished user-storage body after $headerDelay ms waiting for headers',
    async ({ headerDelay }) => {
      const client = new ComfyApi()
      let outcome: PromiseSettledResult<unknown> | undefined
      let disposeBody: (() => void) | undefined
      let requestSignal: AbortSignal | undefined
      vi.mocked(fetch).mockImplementationOnce((_input, init) => {
        const signal = init?.signal
        assert.exists(signal)
        requestSignal = signal
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const abortBody = () => {
              controller.error(signal.reason)
            }
            signal.addEventListener('abort', abortBody, { once: true })
            controller.enqueue(new TextEncoder().encode('{"storage":'))
            disposeBody = () => {
              signal.removeEventListener('abort', abortBody)
              controller.error(new DOMException('Test cleanup', 'AbortError'))
            }
          }
        })
        const response = new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
        return new Promise<Response>((resolve) => {
          setTimeout(() => resolve(response), headerDelay)
        })
      })
      const settled = client.getUserConfig().then(
        (value) => {
          outcome = { status: 'fulfilled', value }
        },
        (reason: unknown) => {
          outcome = { status: 'rejected', reason }
        }
      )
      try {
        await vi.advanceTimersByTimeAsync(59_999)
        expect(outcome).toBeUndefined()
        await vi.advanceTimersByTimeAsync(1)
        expect(outcome).toMatchObject({
          status: 'rejected',
          reason: { name: 'TimeoutError' }
        })
        expect(requestSignal?.aborted).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        disposeBody?.()
        await settled
      }
    }
  )

  it('clears the user-storage deadline when transport rejects', async () => {
    const client = new ComfyApi()
    const failure = new TypeError('Synthetic connection failure')
    vi.mocked(fetch).mockRejectedValueOnce(failure)

    await expect(client.getUserConfig()).rejects.toBe(failure)

    expect(vi.getTimerCount()).toBe(0)
  })

  it.for([
    null,
    {},
    { storage: 'browser' },
    { storage: 'server', migrated: 'yes' },
    { storage: 'server', users: [] },
    { storage: 'server', users: { alice: 17 } }
  ])('rejects malformed user-storage bootstrap %#', async (response) => {
    const client = new ComfyApi()
    vi.spyOn(client, 'fetchApi').mockResolvedValue(Response.json(response))

    await expect(client.getUserConfig()).rejects.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('validates custom-node translations before returning them', async () => {
    const client = new ComfyApi()
    const response = {
      'comfyui-impact-pack': {
        en: { title: 'Impact Pack' },
        'zh-CN': { title: '影响工具包' }
      }
    }
    vi.spyOn(axios, 'get').mockResolvedValueOnce({ data: response })

    await expect(client.getCustomNodesI18n()).resolves.toEqual(response)
  })

  it.for([null, [], 'translations'])(
    'rejects malformed custom-node translations %#',
    async (response) => {
      const client = new ComfyApi()
      vi.spyOn(axios, 'get').mockResolvedValueOnce({ data: response })

      await expect(client.getCustomNodesI18n()).rejects.toThrow()
    }
  )

  it.for([
    {
      name: 'omits details, as the cloud contract allows',
      reason: {
        type: 'unknown_node_class',
        message: "this deployment's build does not contain SomeCustomNode."
      },
      expected:
        '\nSomeCustomNode:\n    - ' +
        "this deployment's build does not contain SomeCustomNode."
    },
    {
      name: 'sends empty details, as core ComfyUI does',
      reason: {
        type: 'prompt_no_outputs',
        message: 'Prompt has no outputs',
        details: ''
      },
      expected: '\nSomeCustomNode:\n    - Prompt has no outputs'
    },
    {
      name: 'sends details',
      reason: {
        type: 'value_not_in_list',
        message: 'Value not in list',
        details: 'ckpt_name: missing.safetensors'
      },
      expected:
        '\nSomeCustomNode:\n    - Value not in list: ckpt_name: missing.safetensors'
    }
  ])('formats a node error that $name', ({ reason, expected }) => {
    expect(
      new PromptExecutionError({
        node_errors: {
          '12': {
            class_type: 'SomeCustomNode',
            errors: [reason],
            dependent_outputs: []
          }
        }
      }).toString()
    ).toBe(expected)
  })

  it.for([
    { name: 'null response', payload: null },
    { name: 'missing data', payload: {} },
    { name: 'non-string data', payload: { data: 17 } },
    { name: 'empty data', payload: { data: '' } }
  ])('rejects $name with the endpoint error', async ({ payload }) => {
    vi.mocked(global.fetch).mockResolvedValue(Response.json(payload))

    await expect(api.getGlobalSubgraphData('blueprint-17')).rejects.toThrow(
      "Global subgraph 'blueprint-17' returned empty data"
    )
  })

  it('validates user-data file metadata before returning it', async () => {
    const files = [{ path: 'workflows/demo.json', size: 17, modified: 42 }]
    vi.mocked(global.fetch).mockResolvedValue(Response.json(files))

    await expect(api.listUserDataFullInfo('workflows')).resolves.toEqual(files)
  })

  it('rejects user-data entries without a path', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      Response.json([{ size: 17, modified: 42 }])
    )

    await expect(api.listUserDataFullInfo('workflows')).rejects.toThrow()
  })

  it('validates global subgraph metadata while preserving local extensions', async () => {
    const subgraphs = {
      'blueprint-17': {
        name: 'Blueprint 17',
        source: 'templates',
        info: { node_pack: 'core', category: 'Examples' },
        data: '{"version":1}',
        essentials_category: 'image'
      }
    }
    vi.mocked(global.fetch).mockResolvedValue(Response.json(subgraphs))

    await expect(api.getGlobalSubgraphs()).resolves.toEqual(subgraphs)
  })

  it('rejects malformed global subgraph metadata', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      Response.json({
        'blueprint-17': {
          name: 'Blueprint 17',
          source: 'templates',
          data: '{"version":1}'
        }
      })
    )

    await expect(api.getGlobalSubgraphs()).rejects.toThrow()
  })

  it('returns valid shareable assets', async () => {
    const response: WorkflowApiAssetsResponse = {
      assets: [
        {
          id: 'asset-17',
          in_library: true,
          model: false,
          name: 'preview.png',
          preview_url: '/preview.png',
          public: false,
          storage_url: '/assets/preview.png'
        }
      ]
    }
    vi.mocked(global.fetch).mockResolvedValue(Response.json(response))

    await expect(api.getShareableAssets({})).resolves.toEqual(response)
  })

  it('rejects malformed successful shareable-assets responses', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      Response.json({
        assets: [
          {
            in_library: true,
            model: false,
            name: 'preview.png',
            preview_url: '/preview.png',
            public: false,
            storage_url: '/assets/preview.png'
          }
        ]
      })
    )

    await expect(api.getShareableAssets({})).rejects.toMatchObject({
      name: 'ZodError'
    })
  })
})
