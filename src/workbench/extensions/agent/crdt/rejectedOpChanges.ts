import { nodesMap } from '@comfyorg/comfy-multi-player'
import type { Op } from '@comfyorg/comfy-multi-player'
import type * as Y from 'yjs'

import type { FrameChanges, NodeChange } from './liveGraphApplier'
import { docLinksIncident } from './liveGraphApplier'
import { documentInteriorWidgetTarget } from './interiorWidgetTarget'

export function changesForRejectedOps(
  doc: Y.Doc,
  ops: readonly Op[]
): FrameChanges {
  const nodes = new Map<string, NodeChange>()
  const widgets = new Map<string, Set<string>>()
  const resyncNodes = new Set<string>()
  const links = new Set<string>()
  const interiorWidgets = new Map<string, Map<string, Set<string>>>()
  const docNodes = nodesMap(doc)
  const settleNode = (id: string): void => {
    if (!docNodes.has(id)) {
      nodes.set(id, 'delete')
      return
    }
    nodes.set(id, 'add')
    for (const link of docLinksIncident(doc, id)) links.add(String(link.id))
  }
  for (const op of ops) {
    if ('path' in op && op.path != null) {
      if (op.op === 'set_widget' && typeof op.inner_widget === 'string') {
        const target = documentInteriorWidgetTarget(doc, op.path)
        if (!target) continue
        const nodes =
          interiorWidgets.get(target.definitionId) ??
          new Map<string, Set<string>>()
        const names = nodes.get(target.nodeId) ?? new Set<string>()
        names.add(op.inner_widget)
        nodes.set(target.nodeId, names)
        interiorWidgets.set(target.definitionId, nodes)
      }
      continue
    }
    switch (op.op) {
      case 'add_node':
      case 'delete_node':
        settleNode(String(op.node_id))
        break
      case 'clear':
        for (const id of op.removed_nodes) settleNode(String(id))
        break
      case 'set_widget': {
        const id = String(op.node_id)
        const names = widgets.get(id) ?? new Set<string>()
        names.add(op.widget)
        widgets.set(id, names)
        break
      }
      case 'set_node_field':
        resyncNodes.add(String(op.node_id))
        break
      case 'connect':
      case 'disconnect':
        links.add(String(op.link_id))
        break
      default:
        break
    }
  }
  return {
    nodes,
    widgets,
    resyncNodes,
    links,
    ...(interiorWidgets.size ? { interiorWidgets } : {})
  }
}
