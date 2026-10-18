import { api } from '@/scripts/api'
import { updateEditorSessionNavigation } from '@/scripts/editorSessionUrl'
import { reportError } from '@/platform/telemetry/reportError'

import {
  nativeRunPlanCapabilitiesSchema,
  nativeRunPlanIdentitySchema,
  nativeRunPlanResultSchema
} from '../../schemas/nativeRunPlan.generated'

export function createNativeRunPlanClient() {
  async function request(route: string, signal: AbortSignal, body?: unknown) {
    try {
      const response = await api.fetchApi(route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
      if (!response.ok) {
        await response.body?.cancel()
        reportError('Native run-plan request refused', {
          surface: 'agent',
          errorType: 'native_run_plan_request_refused',
          context: { status: response.status }
        })
        return undefined
      }
      return await response.json()
    } catch {
      if (!signal.aborted)
        reportError('Native run-plan request unavailable', {
          surface: 'agent',
          errorType: 'native_run_plan_request_unavailable'
        })
      return undefined
    }
  }

  return {
    async enabled(signal: AbortSignal) {
      const result = nativeRunPlanCapabilitiesSchema.safeParse(
        await request('/agent/capabilities', signal)
      )
      return result.success && result.data.runPlanRefreshEnabled
    },
    async update(
      workflowId: string,
      draft: Record<string, unknown>,
      isCurrent: () => boolean,
      signal: AbortSignal
    ) {
      const session = window.name
      const stale = () =>
        signal.aborted || !isCurrent() || window.name !== session
      if (!session.startsWith('eds_') || stale()) return undefined
      const preview = nativeRunPlanIdentitySchema.safeParse(
        await request('/agent/run-plan/preview', signal, {
          workflowId,
          draft: { content: draft }
        })
      )
      if (!preview.success || preview.data.workflowId !== workflowId || stale())
        return undefined
      const result = nativeRunPlanResultSchema.safeParse(
        await request('/agent/run-plan/refresh', signal, preview.data)
      )
      if (
        !result.success ||
        result.data.workflow_id !== workflowId ||
        result.data.version !== preview.data.expectedVersion ||
        result.data.revision !== preview.data.expectedRevision ||
        result.data.candidate_revision !==
          preview.data.expectedCandidateRevision ||
        result.data.expires_at <= Date.now() ||
        stale()
      )
        return undefined
      return result.data
    }
  }
}

export function reloadWithNativeRunPlan(sessionId: string): boolean {
  if (!/^eds_[0-9a-f-]{36}$/.test(sessionId)) return false
  try {
    sessionStorage.setItem('clientId', sessionId)
  } catch {
    return false
  }
  window.name = sessionId
  updateEditorSessionNavigation(sessionId)
  window.location.reload()
  return true
}
