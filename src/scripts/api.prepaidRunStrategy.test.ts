import { expect, it, vi } from 'vitest'

import { ComfyApi } from '@/scripts/api'
import { selectedPrepaidRunStrategy } from '@/scripts/prepaidRunStrategy'
import { zComfyWorkflow } from '@/platform/workflow/validation/schemas/workflowSchema'

it.for(['prepaid', ''] as const)(
  'submits the strategy header only in %s billing mode',
  async (mode) => {
    vi.stubEnv('VITE_RUN_BILLING_MODE', mode)
    selectedPrepaidRunStrategy.value = 'rtx4090'
    const client = new ComfyApi()
    const submit = vi
      .spyOn(client, 'fetchApi')
      .mockResolvedValue(
        Response.json({
          prompt_id: 'b67313ed-bd53-4552-961e-b4028a4cafb5',
          number: 1,
          node_errors: {}
        })
      )
    const workflow = zComfyWorkflow.parse({
      version: 0.4,
      nodes: [],
      links: []
    })
    await client.queuePrompt(0, { output: {}, workflow })
    expect(submit).toHaveBeenCalledExactlyOnceWith('/prompt', {
      method: 'POST',
      headers:
        mode === 'prepaid'
          ? {
              'Content-Type': 'application/json',
              'X-Laimon-Run-Strategy': 'rtx4090'
            }
          : { 'Content-Type': 'application/json' },
      body: expect.any(String)
    })
  }
)
