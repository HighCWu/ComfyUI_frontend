import { nodesMap } from '@comfyorg/comfy-multi-player'
import type * as Y from 'yjs'

import type { LGraph } from '@/lib/litegraph/src/litegraph'
import { toNodeId } from '@/types/nodeId'

import {
  allSubgraphDefinitions,
  readSubgraphDefinitions
} from './agentSubgraphDefinitions'

export function interiorWidgetNodeKey(definitionId: string, nodeId: string) {
  return JSON.stringify(['subgraph', definitionId, nodeId])
}

export function liveInteriorWidgetKey(
  graph: LGraph | null,
  path: readonly (string | number)[]
): string | undefined {
  if (!graph || path.length < 2 || path.length > 9) return undefined
  let node = graph.rootGraph.getNodeById(toNodeId(path[0]))
  for (const id of path.slice(1)) {
    if (!node?.isSubgraphNode()) return undefined
    node = node.subgraph.getNodeById(toNodeId(id))
  }
  return node?.graph && node.graph !== graph.rootGraph
    ? interiorWidgetNodeKey(node.graph.id, String(node.id))
    : undefined
}

export function documentInteriorWidgetTarget(
  doc: Y.Doc,
  path: readonly (string | number)[]
) {
  if (path.length < 2 || path.length > 9) return undefined
  const definitions = allSubgraphDefinitions(readSubgraphDefinitions(doc))
  const resolve = (type: unknown) => {
    const exact = definitions.find((definition) => definition.id === type)
    const aliases = definitions.filter((definition) => definition.name === type)
    return exact ?? (aliases.length === 1 ? aliases[0] : undefined)
  }
  const head = nodesMap(doc).get(String(path[0]))
  let definition = resolve(head?.get('type') ?? String(path[0]))
  for (const [index, id] of path.slice(1).entries()) {
    const node = definition?.nodes?.find(
      (candidate) => String(candidate.id) === String(id)
    )
    if (!node || !definition) return undefined
    if (index === path.length - 2)
      return {
        definitionId: definition.id,
        nodeId: String(id),
        widgets: node.widgets_values_named ?? node.widgets_values
      }
    definition = resolve(node.type)
  }
  return undefined
}

export function documentInteriorWidgetValue(
  doc: Y.Doc,
  key: string,
  name: string
): unknown {
  let parts: unknown
  try {
    parts = JSON.parse(key)
  } catch {
    return undefined
  }
  if (
    !Array.isArray(parts) ||
    parts.length !== 3 ||
    parts[0] !== 'subgraph' ||
    typeof parts[1] !== 'string' ||
    typeof parts[2] !== 'string'
  )
    return undefined
  const target = documentInteriorWidgetTarget(doc, [parts[1], parts[2]])
  const values = target?.widgets
  return values && !Array.isArray(values) && Object.hasOwn(values, name)
    ? values[name]
    : undefined
}
