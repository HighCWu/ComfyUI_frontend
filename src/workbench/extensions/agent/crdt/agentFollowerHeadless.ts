import { computed, effectScope, ref, watch } from 'vue'

import type { LGraph } from '@/lib/litegraph/src/LGraph'
import type { ComfyWorkflow } from '@/platform/workflow/management/stores/comfyWorkflow'
import { api } from '@/scripts/api'
import { toRootGraphId } from '@/types/graphScopeId'
import { parseNodeId } from '@/types/nodeId'

import { comfyApiTransport } from './agentCrdtTransport'
import { attachDocOpMinter } from './docOpMinter'
import type { GraphOperation } from './graphOperations'
import {
  attachRestoreOpMinter,
  notifyRestoreMintersAfterGraphConfigure,
  notifyRestoreMintersBeforeGraphLoad,
  notifyRestoreMintersGraphLoadError
} from './restoreOpMinter'
import { startAgentCrdtFollower } from './useAgentCrdtFollower'
import type {
  AgentCrdtApplierDeps,
  AgentCrdtStatus
} from './useAgentCrdtFollower'

interface HeadlessEnvironment {
  userId(): string | null
  sessionScope(): string | null
  workflow(): ComfyWorkflow | null
  panelEnabled(): boolean
  graph(): LGraph | null
  applier: AgentCrdtApplierDeps
}

export type HeadlessBindResult =
  | { ok: true }
  | {
      ok: false
      code:
        | 'invalid_doc_id'
        | 'identity_unresolved'
        | 'panel_owner_active'
        | 'target_unverified'
        | 'target_not_active'
        | 'disposed'
    }

export function createAgentFollowerHeadless(env: HeadlessEnvironment) {
  const docId = ref<string | null>(null)
  const active = ref(false)
  let binding: {
    workflow: ComfyWorkflow
    path: string
    userId: string
    sessionScope: string | null
    follower: ReturnType<typeof startAgentCrdtFollower>
    stop(): void
  } | null = null
  let disposed = false
  let socket: WebSocket | null = null
  const ownsTarget = computed(
    () =>
      active.value &&
      !env.panelEnabled() &&
      binding !== null &&
      env.userId() === binding.userId &&
      env.sessionScope() === binding.sessionScope &&
      env.workflow() === binding.workflow &&
      env.workflow()?.path === binding.path &&
      env.graph() !== null
  )

  function unbind(): { ok: true } {
    active.value = false
    docId.value = null
    const previous = binding
    binding = null
    previous?.stop()
    socket?.removeEventListener('close', onSocketClose)
    socket = null
    return { ok: true }
  }

  function onSocketClose(event: CloseEvent): void {
    if (event.code === 1008) unbind()
  }

  function observeSocket(): void {
    socket?.removeEventListener('close', onSocketClose)
    socket = binding ? api.socket : null
    socket?.addEventListener('close', onSocketClose)
  }

  function bind(nextDocId: unknown): HeadlessBindResult {
    if (disposed) return { ok: false, code: 'disposed' }
    if (
      typeof nextDocId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        nextDocId
      )
    )
      return { ok: false, code: 'invalid_doc_id' }
    const userId = env.userId()
    if (!userId) return { ok: false, code: 'identity_unresolved' }
    if (env.panelEnabled()) return { ok: false, code: 'panel_owner_active' }
    const workflow = env.workflow()
    if (!workflow || workflow.isTemporary || !env.graph())
      return { ok: false, code: 'target_not_active' }
    const nativeId =
      /^workflows\/\.native-agent\/[^/]+ \(([0-9a-f-]{36})\)\.json$/i.exec(
        workflow.path
      )?.[1]
    if (!nativeId) return { ok: false, code: 'target_unverified' }
    if (nativeId !== nextDocId) return { ok: false, code: 'target_not_active' }
    if (
      binding?.workflow === workflow &&
      docId.value === nextDocId &&
      ownsTarget.value
    )
      return { ok: true }
    unbind()
    docId.value = nextDocId
    const scope = effectScope()
    const follower = scope.run(() =>
      startAgentCrdtFollower(
        docId,
        env.userId,
        ownsTarget,
        env.graph,
        {},
        env.applier,
        () => {
          if (!ownsTarget.value) return null
          workflow.changeTracker?.prepareForSave()
          return workflow.activeState ?? null
        },
        comfyApiTransport
      )
    )
    if (!follower) return { ok: false, code: 'disposed' }
    const enqueue = (operations: GraphOperation[]) => {
      if (binding?.follower === follower && ownsTarget.value)
        follower.enqueueHumanOperations(operations)
    }
    const enabled = () => ownsTarget.value && follower.subscriptionSent()
    const docMinter = attachDocOpMinter({
      isEnabled: () => ownsTarget.value,
      isDocBound: enabled,
      enqueue,
      getGraph: env.graph,
      boundRootGraphId: () =>
        workflow.activeState?.id === undefined
          ? null
          : toRootGraphId(workflow.activeState.id),
      docInputNames: follower.docInputNames,
      docPromotedWidgets: follower.docPromotedWidgets,
      mayWritePromotedHost: follower.mayWritePromotedHost,
      onWidgetWriteRefused: follower.notifyWidgetWriteRefused
    })
    const restoreMinter = attachRestoreOpMinter({
      isEnabled: () => ownsTarget.value,
      isDocBound: enabled,
      enqueue,
      getGraph: env.graph,
      isRestoringState: () => workflow.changeTracker?._restoringState === true,
      docInputNames: (nodeId) => {
        const parsed = parseNodeId(nodeId)
        return parsed === null ? null : follower.docInputNames(parsed)
      }
    })
    binding = {
      workflow,
      path: workflow.path,
      userId,
      sessionScope: env.sessionScope(),
      follower,
      stop() {
        docMinter.detach()
        restoreMinter.detach()
        scope.stop()
      }
    }
    active.value = true
    observeSocket()
    return { ok: true }
  }

  const stopWatching = watch(
    [
      env.userId,
      env.sessionScope,
      env.workflow,
      () => env.workflow()?.path,
      env.panelEnabled,
      env.graph
    ],
    () => {
      if (binding && !ownsTarget.value) unbind()
    },
    { flush: 'sync' }
  )
  api.addEventListener('reconnected', observeSocket)

  return {
    bind,
    unbind,
    status(): {
      started: boolean
      docId: string | null
      crdt: AgentCrdtStatus | null
    } {
      const status = binding?.follower.status.value
      return {
        started: binding !== null,
        docId: docId.value,
        crdt: status ? { ...status, outcomes: { ...status.outcomes } } : null
      }
    },
    beforeLoadGraph() {
      if (!binding) return
      if (binding.workflow.changeTracker?._restoringState !== true) {
        unbind()
        return
      }
      notifyRestoreMintersBeforeGraphLoad()
    },
    afterConfigureGraph() {
      if (binding) notifyRestoreMintersAfterGraphConfigure()
    },
    onGraphLoadError() {
      if (binding) notifyRestoreMintersGraphLoadError()
    },
    dispose() {
      disposed = true
      unbind()
      stopWatching()
      api.removeEventListener('reconnected', observeSocket)
    }
  }
}
