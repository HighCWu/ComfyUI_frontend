import { setActiveLocale } from '@/i18n'
import { watch } from 'vue'
import { setNodeWidgetValue } from '@/core/graph/widgets/nodeWidgetValues'
import { getPreservedQueryParam } from '@/platform/navigation/preservedQueryManager'
import { PRESERVED_QUERY_NAMESPACES } from '@/platform/navigation/preservedQueryNamespaces'
import { useWorkflowStore } from '@/platform/workflow/management/stores/workflowStore'
import { validateComfyWorkflow } from '@/platform/workflow/validation/schemas/workflowSchema'
import { useFocusNode } from '@/composables/canvas/useFocusNode'
import { useQueueSettingsStore } from '@/stores/queueSettingsStore'
import { useCanvasStore } from '@/renderer/core/canvas/canvasStore'
import { layoutStore } from '@/renderer/core/layout/store/layoutStore'
import { useAgentPanelStore } from '@/workbench/extensions/agent/stores/agent/agentPanelStore'
import { createAgentFollowerHeadless } from '@/workbench/extensions/agent/crdt/agentFollowerHeadless'
import { parseNodeId } from '@/types/nodeId'
import type { ComfyWorkflowJSON } from '@/platform/workflow/validation/schemas/workflowSchema'
import type { ComfyExtension } from '@/types/comfy'
import type { WorkflowChangeTracker } from '@/platform/workflow/management/stores/comfyWorkflow'

import {
  EmbeddedBridgeFailure,
  installEmbeddedBridgeReceiver,
  parseEmbeddedBridgeConfig,
  postEmbeddedReady,
  postEmbeddedSnapshot,
  runWithAutoQueueDisabled
} from './domonEmbeddedBridge'
import type { EmbeddedBridgeConfig } from './domonEmbeddedBridge'
import { app } from '../../scripts/app'
import { useEmbeddedFollowerSession } from './domonEmbeddedSession'

const MAX_WORKFLOW_BYTES = 8 * 1024 * 1024
const MAX_APPEARANCE_BYTES = 32 * 1024
const MAX_APPEARANCE_TOKENS = 256
const MAX_WIDGET_VALUE_BYTES = 512 * 1024
const WORKFLOW_REVISION_PATTERN = /^[0-9a-f]{64}$/
const EDITABLE_WIDGET_TYPES = new Set([
  'combo',
  'number',
  'slider',
  'string',
  'text',
  'textarea',
  'toggle'
])

interface ActiveTracker {
  tracker: WorkflowChangeTracker
  capture: WorkflowChangeTracker['captureCanvasState']
  wrapped: () => void
}

interface WorkflowSnapshot {
  workflow: ComfyWorkflowJSON
  revision: string
  serialized: string
}

interface Appearance {
  locale: string
  colorScheme: 'light' | 'dark'
  tokens: Record<string, string>
}

function throwFailure(code: string): never {
  throw new EmbeddedBridgeFailure(code)
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) return true
  }
  return false
}

function parseAppearance(params: Record<string, unknown>): Appearance | null {
  if (
    typeof params.locale !== 'string' ||
    params.locale.length === 0 ||
    params.locale.length > 64 ||
    (params.colorScheme !== 'light' && params.colorScheme !== 'dark') ||
    !isPlainRecord(params.tokens)
  ) {
    return null
  }

  const tokenEntries = Object.entries(params.tokens)
  if (tokenEntries.length > MAX_APPEARANCE_TOKENS) return null

  const tokens: Record<string, string> = {}
  for (const [name, value] of tokenEntries) {
    if (
      !/^--[A-Za-z0-9_-]+$/.test(name) ||
      name.length > 128 ||
      typeof value !== 'string' ||
      value.length > 512 ||
      /url\s*\(|expression\s*\(|@import|[<>;]/i.test(value) ||
      containsControlCharacter(value)
    ) {
      return null
    }
    tokens[name] = value
  }

  if (
    byteLength(
      JSON.stringify({
        locale: params.locale,
        colorScheme: params.colorScheme,
        tokens
      })
    ) > MAX_APPEARANCE_BYTES
  ) {
    return null
  }

  return {
    locale: params.locale,
    colorScheme: params.colorScheme,
    tokens
  }
}

function widgetAcceptsValue(
  widgetType: string,
  values: unknown,
  value: string | number | boolean
): boolean {
  if (!EDITABLE_WIDGET_TYPES.has(widgetType)) return false

  if (widgetType === 'number' || widgetType === 'slider') {
    return typeof value === 'number' && Number.isFinite(value)
  }
  if (widgetType === 'toggle') return typeof value === 'boolean'
  if (
    widgetType === 'text' ||
    widgetType === 'string' ||
    widgetType === 'textarea'
  ) {
    return typeof value === 'string'
  }
  return (
    widgetType !== 'combo' ||
    (Array.isArray(values) && values.some((option) => Object.is(option, value)))
  )
}

function registerEmbeddedReceiver(config: EmbeddedBridgeConfig) {
  const workflowStore = useWorkflowStore()
  const canvasStore = useCanvasStore()
  const panelStore = useAgentPanelStore()
  const follower = createAgentFollowerHeadless({
    ...useEmbeddedFollowerSession(),
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
  })
  let readySent = false
  let disposed = false
  let snapshotGeneration = 0
  let activeTracker: ActiveTracker | null = null
  let activeTokenNames = new Set<string>()

  const serializeWorkflow = (): ComfyWorkflowJSON =>
    app.rootGraph.serialize() as unknown as ComfyWorkflowJSON

  const snapshotFor = async (
    workflow: ComfyWorkflowJSON
  ): Promise<WorkflowSnapshot> => {
    const serialized = JSON.stringify(workflow)
    if (byteLength(serialized) > MAX_WORKFLOW_BYTES) {
      throw new EmbeddedBridgeFailure('payload_too_large')
    }
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(serialized)
    )
    const revision = Array.from(new Uint8Array(digest), (part) =>
      part.toString(16).padStart(2, '0')
    ).join('')
    return { workflow, revision, serialized }
  }

  const publishSnapshot = async (
    workflow: ComfyWorkflowJSON
  ): Promise<void> => {
    const generation = ++snapshotGeneration
    const snapshot = await snapshotFor(workflow)
    if (disposed || generation !== snapshotGeneration) return
    postEmbeddedSnapshot(window, config, {
      workflow: snapshot.workflow,
      revision: snapshot.revision
    })
  }

  const scheduleSnapshot = (workflow: ComfyWorkflowJSON) => {
    void publishSnapshot(workflow).catch(() => undefined)
  }

  const bindActiveTracker = () => {
    const tracker = workflowStore.activeWorkflow?.changeTracker
    if (tracker === activeTracker?.tracker) return

    if (activeTracker) {
      if (activeTracker.tracker.captureCanvasState === activeTracker.wrapped) {
        activeTracker.tracker.captureCanvasState = activeTracker.capture
      }
      activeTracker = null
    }

    if (!tracker) return

    const capture = tracker.captureCanvasState
    const wrapped = () => {
      const previousState = tracker.activeState
      capture.call(tracker)
      if (tracker.activeState !== previousState) {
        scheduleSnapshot(tracker.activeState)
      }
    }
    tracker.captureCanvasState = wrapped
    activeTracker = { tracker, capture, wrapped }
  }

  const isReady = () =>
    readySent && app.isGraphReady && Boolean(workflowStore.activeWorkflow)

  const sendReady = () => {
    if (disposed) return
    bindActiveTracker()
    const tracker = workflowStore.activeWorkflow?.changeTracker
    if (!app.isGraphReady || !tracker) return
    if (!readySent) {
      readySent = true
      postEmbeddedReady(window, config)
    }
    scheduleSnapshot(tracker.activeState)
  }

  const readWorkflow = async () => {
    if (!isReady()) throwFailure('not_ready')
    const workflow = serializeWorkflow()
    const snapshot = await snapshotFor(workflow)
    return { workflow: snapshot.workflow, revision: snapshot.revision }
  }

  const verifyCurrentRevision = async (
    expectedRevision: unknown,
    expectedWorkflow = workflowStore.activeWorkflow
  ) => {
    if (
      !expectedWorkflow ||
      typeof expectedRevision !== 'string' ||
      !WORKFLOW_REVISION_PATTERN.test(expectedRevision)
    ) {
      throwFailure('invalid_request')
    }
    if (!isReady() || workflowStore.activeWorkflow !== expectedWorkflow) {
      throwFailure('not_ready')
    }

    const current = serializeWorkflow()
    const snapshot = await snapshotFor(current)
    if (
      workflowStore.activeWorkflow !== expectedWorkflow ||
      snapshot.revision !== expectedRevision ||
      JSON.stringify(serializeWorkflow()) !== snapshot.serialized
    ) {
      throwFailure('stale_revision')
    }
    return expectedWorkflow
  }

  const rejectAutomaticQueue = () =>
    runWithAutoQueueDisabled(
      useQueueSettingsStore().mode,
      app.ui.autoQueueEnabled,
      () => undefined
    )

  const setWidget = async (params: Record<string, unknown>) => {
    if (
      (typeof params.nodeId !== 'string' &&
        typeof params.nodeId !== 'number') ||
      typeof params.widgetName !== 'string' ||
      params.widgetName.length === 0 ||
      !Object.hasOwn(params, 'value') ||
      (typeof params.value !== 'string' &&
        typeof params.value !== 'number' &&
        typeof params.value !== 'boolean') ||
      (typeof params.value === 'number' && !Number.isFinite(params.value))
    ) {
      throwFailure('invalid_request')
    }
    rejectAutomaticQueue()
    const widgetName = params.widgetName
    const value = params.value

    if (
      typeof value === 'string' &&
      byteLength(JSON.stringify(value)) > MAX_WIDGET_VALUE_BYTES
    ) {
      throwFailure('invalid_request')
    }

    const nodeId = parseNodeId(params.nodeId)
    if (!nodeId) throwFailure('invalid_request')

    const workflow = await verifyCurrentRevision(params.expectedRevision)
    const tracker = workflow.changeTracker
    if (workflowStore.activeWorkflow !== workflow) {
      throwFailure('stale_revision')
    }
    rejectAutomaticQueue()

    const node = app.rootGraph.getNodeById(nodeId)
    if (!node) throwFailure('node_not_found')
    const widget = node.widgets?.find(
      (candidate) => candidate.name === widgetName
    )
    if (!widget) throwFailure('widget_not_found')
    if (
      widget.options.read_only ||
      !widgetAcceptsValue(widget.type, widget.options.values, value)
    ) {
      throwFailure('widget_not_editable')
    }

    runWithAutoQueueDisabled(
      useQueueSettingsStore().mode,
      app.ui.autoQueueEnabled,
      () => {
        tracker.beforeChange()
        try {
          if (!setNodeWidgetValue(node, widgetName, value)) {
            throwFailure('widget_not_found')
          }
        } finally {
          tracker.afterChange()
        }
      }
    )

    const snapshot = await snapshotFor(serializeWorkflow())
    if (workflowStore.activeWorkflow !== workflow)
      throwFailure('stale_revision')
    return { revision: snapshot.revision }
  }

  const undo = async () => {
    if (!isReady()) throwFailure('not_ready')
    rejectAutomaticQueue()
    const workflow = workflowStore.activeWorkflow
    const tracker = workflow?.changeTracker
    if (!tracker) throwFailure('not_ready')
    if (!tracker.undoQueue.length) throwFailure('no_history')
    await runWithAutoQueueDisabled(
      useQueueSettingsStore().mode,
      app.ui.autoQueueEnabled,
      () => tracker.undo()
    )
    if (workflowStore.activeWorkflow !== workflow)
      throwFailure('stale_revision')
    const snapshot = await snapshotFor(serializeWorkflow())
    if (workflowStore.activeWorkflow !== workflow)
      throwFailure('stale_revision')
    return { revision: snapshot.revision }
  }

  const restore = async (params: Record<string, unknown>) => {
    if (!isReady()) throwFailure('not_ready')
    rejectAutomaticQueue()
    const activeWorkflow = workflowStore.activeWorkflow
    const tracker = activeWorkflow?.changeTracker
    if (!activeWorkflow || !tracker) throwFailure('not_ready')
    if (!isPlainRecord(params.workflow)) throwFailure('invalid_request')
    let incoming: string | undefined
    try {
      incoming = JSON.stringify(params.workflow)
    } catch {
      throwFailure('invalid_workflow')
    }
    if (!incoming || byteLength(incoming) > MAX_WORKFLOW_BYTES) {
      throwFailure('payload_too_large')
    }

    const restoredWorkflow = await validateComfyWorkflow(
      params.workflow,
      () => {}
    )
    if (!restoredWorkflow) throwFailure('invalid_workflow')

    const targetWorkflow = await verifyCurrentRevision(
      params.expectedRevision,
      activeWorkflow
    )
    if (
      targetWorkflow !== activeWorkflow ||
      activeWorkflow.changeTracker !== tracker
    ) {
      throwFailure('stale_revision')
    }
    rejectAutomaticQueue()
    const loaded = await runWithAutoQueueDisabled(
      useQueueSettingsStore().mode,
      app.ui.autoQueueEnabled,
      () =>
        app.loadGraphData(restoredWorkflow, true, true, activeWorkflow, {
          checkForRerouteMigration: false,
          silentAssetErrors: true,
          skipAssetScans: true
        })
    )
    if (workflowStore.activeWorkflow !== activeWorkflow)
      throwFailure('stale_revision')
    if (loaded === false || loaded === undefined) {
      throwFailure('restore_failed')
    }
    const snapshot = await snapshotFor(serializeWorkflow())
    if (workflowStore.activeWorkflow !== activeWorkflow)
      throwFailure('stale_revision')
    return { revision: snapshot.revision }
  }

  const focus = async (params: Record<string, unknown>) => {
    if (!isReady()) throwFailure('not_ready')
    const nodeIds = params.nodeIds
    if (nodeIds !== undefined) {
      if (!Array.isArray(nodeIds) || nodeIds.length > 20) {
        throwFailure('invalid_request')
      }
      const nodeId = nodeIds[0]
      if (nodeId !== undefined) {
        if (typeof nodeId !== 'string' && typeof nodeId !== 'number') {
          throwFailure('invalid_request')
        }
        const parsedId = parseNodeId(nodeId)
        if (!parsedId) throwFailure('invalid_request')
        const node = app.rootGraph.getNodeById(parsedId)
        if (!node) throwFailure('node_not_found')
        await useFocusNode().focusNodeInstance(node)
        return { focusedNodeId: String(node.id) }
      }
    }
    app.canvas.canvas.focus()
    return { focused: true }
  }

  const applyAppearance = async (params: Record<string, unknown>) => {
    const appearance = parseAppearance(params)
    if (!appearance) throwFailure('invalid_appearance')

    const locale = await setActiveLocale(appearance.locale)
    const root = document.documentElement
    const nextTokenNames = new Set(Object.keys(appearance.tokens))
    for (const name of activeTokenNames) {
      if (!nextTokenNames.has(name)) root.style.removeProperty(name)
    }
    for (const [name, value] of Object.entries(appearance.tokens)) {
      root.style.setProperty(name, value)
    }
    activeTokenNames = nextTokenNames
    root.lang = locale
    root.style.colorScheme = appearance.colorScheme
    root.classList.toggle('dark-theme', appearance.colorScheme === 'dark')
    return { locale, colorScheme: appearance.colorScheme }
  }

  const removeReceiver = installEmbeddedBridgeReceiver(window, config, {
    'workflow.read': readWorkflow,
    'workflow.setWidget': setWidget,
    'workflow.undo': undo,
    'workflow.restore': restore,
    'editor.focus': focus,
    'editor.appearance': applyAppearance,
    'agent.follower.bind': (params) => follower.bind(params.docId),
    'agent.follower.unbind': () => follower.unbind(),
    'agent.follower.status': () => follower.status()
  })

  const stopWatching = watch(
    () => workflowStore.activeWorkflow?.changeTracker,
    bindActiveTracker,
    {
      immediate: true
    }
  )

  if (workflowStore.activeWorkflow?.changeTracker) sendReady()

  return {
    afterLoadGraph: sendReady,
    beforeLoadGraph: follower.beforeLoadGraph,
    afterConfigureGraph: follower.afterConfigureGraph,
    onGraphLoadError: follower.onGraphLoadError,
    dispose() {
      follower.dispose()
      disposed = true
      snapshotGeneration++
      stopWatching()
      removeReceiver()
      if (
        activeTracker &&
        activeTracker.tracker.captureCanvasState === activeTracker.wrapped
      ) {
        activeTracker.tracker.captureCanvasState = activeTracker.capture
      }
      activeTracker = null
    }
  }
}

const embeddedConfig = parseEmbeddedBridgeConfig(
  window.location.search,
  window.location.href,
  {
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
  }
)

if (embeddedConfig && window.parent !== window) {
  let embeddedSession: ReturnType<typeof registerEmbeddedReceiver> | null = null
  const extension: ComfyExtension = {
    name: 'DomonAI.EmbeddedComfyBridge',
    setup() {
      embeddedSession ??= registerEmbeddedReceiver(embeddedConfig)
    },
    afterLoadGraph() {
      embeddedSession?.afterLoadGraph()
    },
    beforeLoadGraph() {
      embeddedSession?.beforeLoadGraph()
    },
    afterConfigureGraph() {
      embeddedSession?.afterConfigureGraph()
    },
    onGraphLoadError() {
      embeddedSession?.onGraphLoadError()
    }
  }
  app.registerExtension(extension)

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      embeddedSession?.dispose()
      embeddedSession = null
    })
  }
}
