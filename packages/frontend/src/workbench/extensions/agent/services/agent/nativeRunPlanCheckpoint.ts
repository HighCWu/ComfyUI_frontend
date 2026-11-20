import type { ComfyWorkflow } from '@/platform/workflow/management/stores/comfyWorkflow'
import { reportError } from '@/platform/telemetry/reportError'

export async function checkpointNativeRunPlan(
  target: ComfyWorkflow,
  save: (workflow: ComfyWorkflow) => Promise<boolean>,
  readCurrentDraft: () => Record<string, unknown> | null
): Promise<Record<string, unknown> | null> {
  try {
    if (!target.isTemporary && !(await save(target))) return null
    return readCurrentDraft()
  } catch {
    reportError('Native workflow checkpoint unavailable', {
      surface: 'agent',
      errorType: 'native_run_plan_checkpoint_failed'
    })
    return null
  }
}
