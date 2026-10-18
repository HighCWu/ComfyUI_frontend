import * as Y from 'yjs'

import type { GraphOperation } from './graphOperations'

interface RestoredLife {
  incarnation: string
  tombstone: string | undefined
}

export function createHumanNodeIncarnationBinder() {
  const documents = new WeakMap<Y.Doc, Map<string, RestoredLife>>()
  return (operations: GraphOperation[], doc: Y.Doc) => {
    const pending = documents.get(doc) ?? new Map<string, RestoredLife>()
    documents.set(doc, pending)
    return bindHumanNodeIncarnations(operations, doc, pending)
  }
}

export function bindHumanNodeIncarnations(
  operations: GraphOperation[],
  doc: Y.Doc,
  restoredLives = new Map<string, RestoredLife>()
): GraphOperation[] {
  return operations.map((operation) => {
    if (
      !('node_id' in operation) ||
      ('path' in operation && (operation.path?.length ?? 0) > 0)
    )
      return operation
    const nodeId = String(operation.node_id)
    const tombstone = JSON.stringify(
      doc.getMap('__stamps').get(JSON.stringify(['node', nodeId]))
    )
    if (restoredLives.get(nodeId)?.tombstone !== tombstone)
      restoredLives.delete(nodeId)
    if (operation.op === 'delete_node') restoredLives.delete(nodeId)
    if (
      operation.op === 'add_node' &&
      (operation.path?.length ?? 0) === 0 &&
      !doc.getMap('nodes').has(String(operation.node_id)) &&
      doc
        .getMap('__stamps')
        .has(JSON.stringify(['node', String(operation.node_id)]))
    ) {
      const incarnation = operation.node_incarnation ?? crypto.randomUUID()
      restoredLives.set(nodeId, { incarnation, tombstone })
      return { ...operation, node_incarnation: incarnation }
    }
    if (
      (operation.op !== 'set_widget' && operation.op !== 'set_node_field') ||
      operation.node_incarnation !== undefined ||
      ('path' in operation && (operation.path?.length ?? 0) > 0)
    )
      return operation
    const node = doc.getMap('nodes').get(String(operation.node_id))
    const incarnation =
      restoredLives.get(nodeId)?.incarnation ??
      (node instanceof Y.Map ? node.get('__incarnation') : null)
    return typeof incarnation === 'string' && incarnation !== '0'
      ? { ...operation, node_incarnation: incarnation }
      : operation
  })
}
