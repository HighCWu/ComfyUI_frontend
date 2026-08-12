import { api } from '@/scripts/api'
import { app } from '@/scripts/app'
import type { ComfyWorkflowJSON } from '@/platform/workflow/validation/schemas/workflowSchema'

interface EditorLaunchResponse {
  launch: {
    label: string | null
    workflow: ComfyWorkflowJSON
  } | null
}

export function useEditorLaunchWorkflow() {
  async function loadEditorLaunchWorkflow(): Promise<boolean> {
    if (!window.name.startsWith('eds_')) return false
    const response = await api.fetchApi(
      `/editor-launch?client_id=${encodeURIComponent(window.name)}`,
      { cache: 'no-store' }
    )
    if (!response.ok) return false
    const payload = (await response.json()) as EditorLaunchResponse
    if (!payload.launch) return false
    await app.loadGraphData(
      payload.launch.workflow,
      true,
      true,
      payload.launch.label ?? 'Launch workflow'
    )
    return true
  }

  return { loadEditorLaunchWorkflow }
}
