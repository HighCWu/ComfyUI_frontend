import { watch } from 'vue'

import type { ComfyWorkflow } from '@/platform/workflow/management/stores/comfyWorkflow'
import type { HeadlessBindResult } from '@/workbench/extensions/agent/crdt/agentFollowerHeadless'
import { EmbeddedBridgeFailure } from './domonEmbeddedBridge'

interface NativeOpenEnvironment {
  userId(): string | null
  sessionScope(): string | null
  panelEnabled(): boolean
  assertCanOpen(): void
  workflow(): ComfyWorkflow | null
  syncWorkflows(directory: string): Promise<unknown>
  getWorkflowByPath(path: string): ComfyWorkflow | null
  readUserData(path: string): Promise<Response>
  openWorkflow(
    workflow: ComfyWorkflow,
    options: { isCurrent(): boolean }
  ): Promise<boolean>
  bind(docId: string): HeadlessBindResult
}

type NativeOpenResult =
  | HeadlessBindResult
  | {
      ok: false
      code:
        | 'invalid_native_path'
        | 'native_document_unavailable'
        | 'native_open_failed'
        | 'identity_changed'
    }

export function createEmbeddedNativeOpener(env: NativeOpenEnvironment) {
  let generation = 0
  let operation = 0
  let disposed = false
  const stop = watch(
    [env.userId, env.sessionScope, env.panelEnabled],
    () => {
      generation++
    },
    { flush: 'sync' }
  )

  return {
    async open(params: Record<string, unknown>): Promise<NativeOpenResult> {
      if (disposed) return { ok: false, code: 'disposed' }
      const docId = params.docId,
        editorPath = params.editorPath
      if (
        typeof docId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          docId
        )
      )
        return { ok: false, code: 'invalid_doc_id' }
      if (
        typeof editorPath !== 'string' ||
        !editorPath.startsWith('workflows/.native-agent/') ||
        editorPath.slice('workflows/.native-agent/'.length).includes('/') ||
        !editorPath.endsWith(` (${docId}).json`) ||
        editorPath === `workflows/.native-agent/ (${docId}).json`
      )
        return { ok: false, code: 'invalid_native_path' }
      const userId = env.userId(),
        sessionScope = env.sessionScope()
      if (!userId || !sessionScope)
        return { ok: false, code: 'identity_unresolved' }
      if (env.panelEnabled()) return { ok: false, code: 'panel_owner_active' }
      const previousWorkflow = env.workflow()
      let target: ComfyWorkflow | null = null
      const ownGeneration = generation,
        ownOperation = ++operation
      const isCurrent = () =>
        !disposed &&
        ownGeneration === generation &&
        ownOperation === operation &&
        env.userId() === userId &&
        env.sessionScope() === sessionScope &&
        !env.panelEnabled() &&
        (env.workflow() === previousWorkflow || env.workflow() === target)
      try {
        env.assertCanOpen()
        await env.syncWorkflows('.native-agent')
        if (!isCurrent()) return { ok: false, code: 'identity_changed' }
        target = env.getWorkflowByPath(editorPath)
        if (!target || target.isTemporary || target.path !== editorPath)
          return { ok: false, code: 'target_unverified' }
        const response = await env.readUserData(editorPath)
        await response.body?.cancel()
        if (!isCurrent()) return { ok: false, code: 'identity_changed' }
        if (response.status !== 200)
          return { ok: false, code: 'native_document_unavailable' }
        env.assertCanOpen()
        if (!(await env.openWorkflow(target, { isCurrent })))
          return {
            ok: false,
            code: isCurrent() ? 'native_open_failed' : 'identity_changed'
          }
        if (!isCurrent()) return { ok: false, code: 'identity_changed' }
        if (env.workflow() !== target || target.path !== editorPath)
          return { ok: false, code: 'target_not_active' }
        return env.bind(docId)
      } catch (error) {
        if (error instanceof EmbeddedBridgeFailure) throw error
        return {
          ok: false,
          code: isCurrent() ? 'native_open_failed' : 'identity_changed'
        }
      }
    },
    dispose() {
      disposed = true
      generation++
      stop()
    }
  }
}
