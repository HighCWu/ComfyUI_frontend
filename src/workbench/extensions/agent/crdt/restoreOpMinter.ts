import type { WorkflowNode } from '@comfyorg/comfy-multi-player'

import type { LGraph } from '@/lib/litegraph/src/LGraph'
import type { LLink } from '@/lib/litegraph/src/LLink'
import { reportError } from '@/platform/telemetry/reportError'

import { docInputIndex, wireNodeSnapshot } from './docOpMinter'
import type { GraphOperation } from './graphOperations'

export interface RestoreOpMinterDeps {
  isEnabled(): boolean
  isDocBound(): boolean
  enqueue(operations: GraphOperation[]): void
  /** The live root graph, or null when no workflow is open. */
  getGraph(): LGraph | null
  /** True while the active workflow's ChangeTracker replays an undo/redo. */
  isRestoringState(): boolean
  /** Input names in the bound document's stable order. */
  docInputNames(nodeId: string): readonly (string | undefined)[] | null
}

export interface RestoreOpMinter {
  detach(): void
}

interface RestoreSnapshot {
  nodes: Map<string, WorkflowNode>
  links: Map<string, LLink>
  /**
   * Nodes present in the graph whose `serialize()` threw. Absence from `nodes`
   * otherwise reads as "not in the graph", which the diff would turn into an
   * addition or a deletion of a node that is still on the canvas.
   */
  unserializableNodeIds: string[]
}

interface RestoreListener {
  onBeforeGraphLoad(): void
  onAfterGraphConfigure(): void
  onGraphLoadError(): void
}

const activeMinters = new Set<RestoreListener>()

export function notifyRestoreMintersBeforeGraphLoad(): void {
  for (const minter of activeMinters) minter.onBeforeGraphLoad()
}

export function notifyRestoreMintersAfterGraphConfigure(): void {
  for (const minter of activeMinters) minter.onAfterGraphConfigure()
}

export function notifyRestoreMintersGraphLoadError(): void {
  for (const minter of activeMinters) minter.onGraphLoadError()
}

function snapshotGraph(graph: LGraph): RestoreSnapshot {
  const nodes = new Map<string, WorkflowNode>()
  const unserializableNodeIds: string[] = []
  for (const node of graph._nodes) {
    const serialized = wireNodeSnapshot(node)
    if (serialized) nodes.set(String(node.id), serialized)
    else unserializableNodeIds.push(String(node.id))
  }
  const links = new Map<string, LLink>()
  for (const link of graph.links.values()) links.set(String(link.id), link)
  return { nodes, links, unserializableNodeIds }
}

function widgetValuesOf(node: WorkflowNode): Record<string, unknown> {
  const values = node.widgets_values
  return values != null && typeof values === 'object' && !Array.isArray(values)
    ? values
    : {}
}

function removedNodeOperations(
  before: RestoreSnapshot,
  after: RestoreSnapshot
): GraphOperation[] {
  return [...before.nodes.keys()].flatMap((id) => {
    if (after.nodes.has(id)) return []
    const removedLinks = [...before.links.values()]
      .filter(
        (link) => String(link.origin_id) === id || String(link.target_id) === id
      )
      .map((link) => link.id)
    return [{ op: 'delete_node', node_id: id, removed_links: removedLinks }]
  })
}

function addedNodeOperations(
  before: RestoreSnapshot,
  after: RestoreSnapshot
): GraphOperation[] {
  return [...after.nodes].flatMap(([id, node]) =>
    before.nodes.has(id)
      ? []
      : [
          {
            op: 'add_node',
            node_id: id,
            class_type: node.type,
            pos: Array.isArray(node.pos) ? node.pos : [0, 0],
            node
          }
        ]
  )
}

function changedWidgetOperations(
  before: RestoreSnapshot,
  after: RestoreSnapshot
): GraphOperation[] {
  return [...after.nodes].flatMap(([id, node]) => {
    const previous = before.nodes.get(id)
    if (!previous) return []
    const oldValues = widgetValuesOf(previous)
    return Object.entries(widgetValuesOf(node)).flatMap(([name, value]) => {
      const old = oldValues[name]
      return JSON.stringify(old) === JSON.stringify(value)
        ? []
        : [{ op: 'set_widget', node_id: id, widget: name, value, old }]
    })
  })
}

function changedNodeFieldOperations(
  before: RestoreSnapshot,
  after: RestoreSnapshot
): GraphOperation[] {
  return [...after.nodes].flatMap(([id, node]) => {
    const previous = before.nodes.get(id)
    if (!previous) return []
    const operations: GraphOperation[] = []
    if (
      previous.title !== node.title &&
      (node.title == null || typeof node.title === 'string')
    ) {
      operations.push({
        op: 'set_node_field',
        node_id: id,
        field: 'title',
        value: node.title ?? null
      })
    }
    if (previous.mode !== node.mode) {
      operations.push({
        op: 'set_node_field',
        node_id: id,
        field: 'mode',
        value: node.mode ?? null
      })
    }
    for (const flag of ['collapsed', 'pinned'] as const) {
      const value = node.flags?.[flag]
      if (
        previous.flags?.[flag] !== value &&
        (value == null || typeof value === 'boolean')
      ) {
        operations.push({
          op: 'set_node_field',
          node_id: id,
          field: `flags.${flag}`,
          value: value ?? null
        })
      }
    }
    return operations
  })
}

function addedLinkOperations(
  before: RestoreSnapshot,
  after: RestoreSnapshot,
  deps: RestoreOpMinterDeps
): GraphOperation[] {
  return [...after.links].flatMap(([id, link]) => {
    if (before.links.has(id)) return []
    const targetId = String(link.target_id)
    const targetAdded = !before.nodes.has(targetId)
    const serializedInput =
      after.nodes.get(targetId)?.inputs?.[link.target_slot]
    const input =
      serializedInput &&
      typeof serializedInput === 'object' &&
      'name' in serializedInput &&
      typeof serializedInput.name === 'string'
        ? { name: serializedInput.name }
        : undefined
    const toSlot = targetAdded
      ? link.target_slot
      : docInputIndex(deps.docInputNames(targetId), input, link.target_slot)
    if (toSlot === undefined) return []
    return [
      {
        op: 'connect',
        link_id: link.id,
        from_node: link.origin_id,
        from_slot: link.origin_slot,
        to_node: link.target_id,
        to_slot: toSlot,
        link_type: String(link.type)
      }
    ]
  })
}

function removedLinkOperations(
  before: RestoreSnapshot,
  after: RestoreSnapshot,
  deps: RestoreOpMinterDeps
): GraphOperation[] | undefined {
  const operations: GraphOperation[] = []
  for (const [id, link] of before.links) {
    if (after.links.has(id)) continue
    const endpointRemoved =
      !after.nodes.has(String(link.origin_id)) ||
      !after.nodes.has(String(link.target_id))
    if (endpointRemoved) continue
    const targetId = String(link.target_id)
    const slot = before.nodes.get(targetId)?.inputs?.[link.target_slot]
    const input =
      slot &&
      typeof slot === 'object' &&
      'name' in slot &&
      typeof slot.name === 'string'
        ? { name: slot.name }
        : undefined
    const toSlot = docInputIndex(
      deps.docInputNames(targetId),
      input,
      link.target_slot
    )
    if (toSlot === undefined) {
      reportError(
        'Cannot resolve the removed link input while restoring the workflow',
        {
          surface: 'agent',
          errorType: 'failure_restoring_agent_removed_link_input',
          context: { linkId: id }
        }
      )
      return undefined
    }
    operations.push({
      op: 'disconnect',
      link_id: link.id,
      to_node: link.target_id,
      to_slot: toSlot
    })
  }
  return operations
}

function diffRestore(
  before: RestoreSnapshot,
  after: RestoreSnapshot,
  deps: RestoreOpMinterDeps
): GraphOperation[] {
  const unserializable = [
    ...new Set([
      ...before.unserializableNodeIds,
      ...after.unserializableNodeIds
    ])
  ]
  if (unserializable.length > 0) {
    console.error(
      '[agent-crdt] undo/redo restore snapshot could not serialize every present node; skipping the restore diff so the doc is not told a still-present node was deleted',
      unserializable
    )
    return []
  }
  const removedLinks = removedLinkOperations(before, after, deps)
  if (removedLinks === undefined) return []
  return [
    ...removedNodeOperations(before, after),
    ...addedNodeOperations(before, after),
    ...changedWidgetOperations(before, after),
    ...changedNodeFieldOperations(before, after),
    ...removedLinks,
    ...addedLinkOperations(before, after, deps)
  ]
}

export function attachRestoreOpMinter(
  deps: RestoreOpMinterDeps
): RestoreOpMinter {
  let restoreSnapshot: RestoreSnapshot | null = null

  const listener: RestoreListener = {
    onBeforeGraphLoad() {
      restoreSnapshot = null
      if (!deps.isRestoringState() || !deps.isEnabled() || !deps.isDocBound())
        return
      const graph = deps.getGraph()
      if (graph) restoreSnapshot = snapshotGraph(graph)
    },
    onAfterGraphConfigure() {
      const before = restoreSnapshot
      restoreSnapshot = null
      if (!before) return
      const graph = deps.getGraph()
      if (!graph) return
      const operations = diffRestore(before, snapshotGraph(graph), deps)
      if (operations.length > 0) deps.enqueue(operations)
    },
    onGraphLoadError() {
      restoreSnapshot = null
    }
  }
  activeMinters.add(listener)

  return {
    detach() {
      activeMinters.delete(listener)
      restoreSnapshot = null
    }
  }
}
