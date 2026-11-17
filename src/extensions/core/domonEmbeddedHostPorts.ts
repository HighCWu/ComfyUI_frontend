import type { ComfyApp } from '@/types/comfy'
import type { CatalogueReaderPorts } from '@/extensions/core/domonCatalogueReaderPorts'
import type { ComfyWorkflow } from '@/platform/workflow/management/stores/comfyWorkflow'
import type { validateComfyWorkflow } from '@/platform/workflow/validation/schemas/workflowSchema'
import type { LGraphNode } from '@/lib/litegraph/src/LGraphNode'
import type { parseNodeId } from '@/types/nodeId'
import type { setNodeWidgetValue } from '@/core/graph/widgets/nodeWidgetValues'
import type { createAgentFollowerHeadless } from '@/workbench/extensions/agent/crdt/agentFollowerHeadless'

export interface EmbeddedHostPorts {
  version: 'domon-comfy-embedded-ports/v3'
  canvasImportGuardVersion?: 1
  app: Pick<
    ComfyApp,
    | 'isGraphReady'
    | 'rootGraph'
    | 'canvas'
    | 'ui'
    | 'loadGraphData'
    | 'isApiJson'
    | 'loadApiJson'
  >
  userId(): string | null
  sessionScope(): string | null
  panelEnabled(): boolean
  getWorkflow(): ComfyWorkflow | null
  getQueueMode(): string
  subscribeWorkflowTracker(listener: () => void): () => void
  subscribeIdentity(listener: () => void): () => void
  createFollower(): ReturnType<typeof createAgentFollowerHeadless>
  parseNodeId: typeof parseNodeId
  setNodeWidgetValue: typeof setNodeWidgetValue
  validateComfyWorkflow: typeof validateComfyWorkflow
  focusNode(node: LGraphNode): Promise<void>
  setActiveLocale(locale: string): Promise<string>
  syncWorkflows(directory: string): Promise<unknown>
  getWorkflowByPath(path: string): ComfyWorkflow | null
  readUserData(path: string): Promise<Response>
  openWorkflow(
    workflow: ComfyWorkflow,
    options: { isCurrent(): boolean }
  ): Promise<boolean>
  preservedQuery(): Partial<
    Record<'domon-embedded' | 'domon-host' | 'domon-channel', string>
  >
  installCatalogueReaders(ports: CatalogueReaderPorts): () => void
}
