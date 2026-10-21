import { expect, it, vi } from 'vitest'

import { ComfyApi } from '@/scripts/api'
import { selectedPrepaidRunStrategy } from '@/scripts/prepaidRunStrategy'
import { zComfyWorkflow } from '@/platform/workflow/validation/schemas/workflowSchema'

it.for([
  {
    mode: 'prepaid',
    headers: {
      'Content-Type': 'application/json',
      'X-Laimon-Run-Strategy': 'rtx4090'
    }
  },
  { mode: '', headers: { 'Content-Type': 'application/json' } }
])(
  'submits the expected strategy header in "$mode" billing mode',
  async ({ mode, headers }) => {
    vi.stubEnv('VITE_RUN_BILLING_MODE', mode)
    selectedPrepaidRunStrategy.value = 'rtx4090'
    const client = new ComfyApi()
    const submit = vi.spyOn(client, 'fetchApi').mockResolvedValue(
      Response.json({
        prompt_id: 'b67313ed-bd53-4552-961e-b4028a4cafb5',
        number: 1,
        node_errors: {}
      })
    )
    const workflow = zComfyWorkflow.parse({
      version: 0.4,
      last_node_id: 0,
      last_link_id: 0,
      nodes: [],
      links: []
    })
    await client.queuePrompt(0, { output: {}, workflow })
    expect(submit).toHaveBeenCalledExactlyOnceWith('/prompt', {
      method: 'POST',
      headers,
      body: expect.any(String)
    })
  }
)
