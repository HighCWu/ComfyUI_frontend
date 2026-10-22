import { api } from '@/scripts/api'
import { app } from '@/scripts/app'
import { z } from 'zod'
import type { ComfyWorkflowJSON } from '@/platform/workflow/validation/schemas/workflowSchema'
import { useWorkflowStore } from '@/platform/workflow/management/stores/workflowStore'
import { useWorkflowService } from '@/platform/workflow/core/services/workflowService'
import { reportError } from '@/platform/telemetry/reportError'

const savedWorkflowPath = z
  .string()
  .max(2048)
  .refine(
    (path) =>
      path.startsWith('workflows/') &&
      /\.json$/i.test(path) &&
      !path.includes('\\') &&
      !Array.from(path).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      ) &&
      !path.split('/').some((part) => !part || part === '.' || part === '..')
  )

const editorLaunchResponseSchema = z.object({
  launch: z
    .union([
      z.object({
        label: z.string().nullable(),
        workflow: z.record(z.string(), z.unknown()),
        saved_workflow: z.never().optional()
      }),
      z.object({
        label: z.string().nullable(),
        saved_workflow: z.object({ path: savedWorkflowPath }).strict(),
        workflow: z.never().optional()
      })
    ])
    .nullable()
})

export function useEditorLaunchWorkflow() {
  async function loadEditorLaunchWorkflow(): Promise<
    'not-present' | 'loaded' | 'failed'
  > {
    if (!window.name.startsWith('eds_')) return 'not-present'
    try {
      const response = await api.fetchApi(
        `/editor-launch?client_id=${encodeURIComponent(window.name)}`,
        { cache: 'no-store' }
      )
      if (!response.ok)
        return failedLaunch(`Editor launch refused (${response.status})`)
      const payload = editorLaunchResponseSchema.safeParse(
        await response.json()
      )
      if (!payload.success) return failedLaunch(payload.error)
      if (!payload.data.launch) return 'not-present'
      const selected = payload.data.launch.saved_workflow
      if (selected) {
        const store = useWorkflowStore()
        await store.syncWorkflows()
        const workflow = store.getWorkflowByPath(selected.path)
        if (!workflow)
          return failedLaunch('Selected saved workflow is unavailable')
        return (await useWorkflowService().openWorkflow(workflow, {
          force: true
        }))
          ? 'loaded'
          : failedLaunch('Selected saved workflow could not be opened')
      }
      if (app.isApiJson(payload.data.launch.workflow)) {
        await app.loadApiJson(
          payload.data.launch.workflow,
          payload.data.launch.label ?? 'Launch workflow'
        )
        return 'loaded'
      }
      await app.loadGraphData(
        payload.data.launch.workflow as ComfyWorkflowJSON,
        true,
        true,
        payload.data.launch.label ?? 'Launch workflow'
      )
      return 'loaded'
    } catch (cause) {
      return failedLaunch(cause)
    }
  }

  return { loadEditorLaunchWorkflow }
}

function failedLaunch(cause: unknown): 'failed' {
  reportError(cause, {
    errorType: 'error_loading_editor_launch',
    surface: 'graph'
  })
  return 'failed'
}
