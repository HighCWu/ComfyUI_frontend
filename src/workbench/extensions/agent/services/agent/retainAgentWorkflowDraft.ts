import { useSettingStore } from '@/platform/settings/settingStore'
import { reportError } from '@/platform/telemetry/reportError'
import type { ComfyWorkflow } from '@/platform/workflow/management/stores/comfyWorkflow'
import { useWorkflowDraftStoreV2 } from '@/platform/workflow/persistence/stores/workflowDraftStoreV2'

export function retainAgentWorkflowDraft(workflow: ComfyWorkflow): boolean {
  if (!workflow.isTemporary || !useSettingStore().get('Comfy.Workflow.Persist'))
    return true
  const state = workflow.activeState
  if (!state) return false
  let data: string
  try {
    data = JSON.stringify(state)
  } catch (error) {
    reportError(error, {
      surface: 'agent',
      errorType: 'agent_draft_serialization_failed'
    })
    return false
  }
  return useWorkflowDraftStoreV2().saveDraft(workflow.path, data, {
    name: workflow.key,
    isTemporary: true
  })
}
