import { watch } from 'vue'

import { useFocusNode } from '@/composables/canvas/useFocusNode'
import { setNodeWidgetValue } from '@/core/graph/widgets/nodeWidgetValues'
import { setActiveLocale } from '@/i18n'
import { getPreservedQueryParam } from '@/platform/navigation/preservedQueryManager'
import { PRESERVED_QUERY_NAMESPACES } from '@/platform/navigation/preservedQueryNamespaces'
import { useWorkflowService } from '@/platform/workflow/core/services/workflowService'
import { useWorkflowStore } from '@/platform/workflow/management/stores/workflowStore'
import { validateComfyWorkflow } from '@/platform/workflow/validation/schemas/workflowSchema'
import { useCanvasStore } from '@/renderer/core/canvas/canvasStore'
import { layoutStore } from '@/renderer/core/layout/store/layoutStore'
import { api } from '@/scripts/api'
import { app } from '@/scripts/app'
import { useQueueSettingsStore } from '@/stores/queueSettingsStore'
import { parseNodeId } from '@/types/nodeId'
import { createAgentFollowerHeadless } from '@/workbench/extensions/agent/crdt/agentFollowerHeadless'
import { useAgentPanelStore } from '@/workbench/extensions/agent/stores/agent/agentPanelStore'

import type { EmbeddedHostPorts } from './domonEmbeddedHostPorts'

import { useEmbeddedFollowerSession } from './domonEmbeddedSession'

export const DOMON_EMBEDDED_HOST_PORTS_VERSION = 'domon-comfy-embedded-ports/v1'

export function createEmbeddedHostPorts(): EmbeddedHostPorts {
  const workflowStore = useWorkflowStore()
  const canvasStore = useCanvasStore()
  const panelStore = useAgentPanelStore()
  const session = useEmbeddedFollowerSession()
  return {
    version: DOMON_EMBEDDED_HOST_PORTS_VERSION,
    app,
    ...session,
    panelEnabled: () => panelStore.enabled,
    getWorkflow: () => workflowStore.activeWorkflow,
    getQueueMode: () => useQueueSettingsStore().mode,
    subscribeWorkflowTracker: (listener) =>
      watch(() => workflowStore.activeWorkflow?.changeTracker, listener, {
        immediate: true
      }),
    subscribeIdentity: (listener) =>
      watch(
        [session.userId, session.sessionScope, () => panelStore.enabled],
        listener,
        {
          flush: 'sync'
        }
      ),
    createFollower: () =>
      createAgentFollowerHeadless({
        ...session,
        workflow: () => workflowStore.activeWorkflow,
        panelEnabled: () => panelStore.enabled,
        graph: () =>
          canvasStore.canvas && app.isGraphReady ? app.rootGraph : null,
        applier: {
          getCanvas: () => app.canvas,
          withRemoteActor: (actor, fn) => layoutStore.withActor(actor, fn),
          viewportBounds() {
            const canvas = canvasStore.canvas
            if (!canvas || canvas.graph?.isRootGraph === false) return null
            const [x, y, width, height] = canvas.ds.visible_area
            return { x, y, width, height }
          }
        }
      }),
    parseNodeId,
    setNodeWidgetValue,
    validateComfyWorkflow,
    focusNode: (node) => useFocusNode().focusNodeInstance(node),
    setActiveLocale,
    syncWorkflows: (directory) => workflowStore.syncWorkflows(directory),
    getWorkflowByPath: (path) => workflowStore.getWorkflowByPath(path),
    readUserData: (path) => api.getUserData(path),
    openWorkflow: (workflow, options) =>
      useWorkflowService().openWorkflow(workflow, options),
    preservedQuery: () => ({
      'domon-embedded': getPreservedQueryParam(
        PRESERVED_QUERY_NAMESPACES.EMBEDDED_EDITOR,
        'domon-embedded'
      ),
      'domon-host': getPreservedQueryParam(
        PRESERVED_QUERY_NAMESPACES.EMBEDDED_EDITOR,
        'domon-host'
      ),
      'domon-channel': getPreservedQueryParam(
        PRESERVED_QUERY_NAMESPACES.EMBEDDED_EDITOR,
        'domon-channel'
      )
    })
  }
}
