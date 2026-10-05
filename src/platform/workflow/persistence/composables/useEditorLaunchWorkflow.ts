import { api } from '@/scripts/api'
import { app } from '@/scripts/app'
import type {
  ComfyApiWorkflow,
  ComfyWorkflowJSON
} from '@/platform/workflow/validation/schemas/workflowSchema'

interface EditorLaunchResponse {
  launch: {
    label: string | null
    workflow: ComfyWorkflowJSON | ComfyApiWorkflow
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
    if (app.isApiJson(payload.launch.workflow)) {
      app.loadApiJson(
        payload.launch.workflow,
        payload.launch.label ?? 'Launch workflow'
      )
      return true
    }
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
