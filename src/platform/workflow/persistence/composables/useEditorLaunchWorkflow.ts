import { api } from '@/scripts/api'
import { app } from '@/scripts/app'
import { z } from 'zod'
import type { ComfyWorkflowJSON } from '@/platform/workflow/validation/schemas/workflowSchema'

const editorLaunchResponseSchema = z.object({
  launch: z
    .object({
      label: z.string().nullable(),
      workflow: z.record(z.string(), z.unknown())
    })
    .nullable()
})

export function useEditorLaunchWorkflow() {
  async function loadEditorLaunchWorkflow(): Promise<boolean> {
    if (!window.name.startsWith('eds_')) return false
    const response = await api.fetchApi(
      `/editor-launch?client_id=${encodeURIComponent(window.name)}`,
      { cache: 'no-store' }
    )
    if (!response.ok) return false
    const payload = editorLaunchResponseSchema.safeParse(await response.json())
    if (!payload.success) return false
    if (!payload.data.launch) return false
    if (app.isApiJson(payload.data.launch.workflow)) {
      await app.loadApiJson(
        payload.data.launch.workflow,
        payload.data.launch.label ?? 'Launch workflow'
      )
      return true
    }
    await app.loadGraphData(
      payload.data.launch.workflow as ComfyWorkflowJSON,
      true,
      true,
      payload.data.launch.label ?? 'Launch workflow'
    )
    return true
  }

  return { loadEditorLaunchWorkflow }
}
