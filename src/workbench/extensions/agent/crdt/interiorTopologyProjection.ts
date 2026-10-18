import { isEqual } from 'es-toolkit'

import type { Subgraph } from '@/lib/litegraph/src/litegraph'
import { LiteGraph } from '@/lib/litegraph/src/litegraph'
import type { ExportedSubgraph } from '@/lib/litegraph/src/types/serialisation'
import { toLinkId } from '@/types/linkId'
import { toNodeId } from '@/types/nodeId'

function portShape(ports: readonly { name: string; type: unknown }[]) {
  return ports.map(({ name, type }) => ({ name, type }))
}

export function projectInteriorLinks(
  graph: Subgraph,
  definition: ExportedSubgraph
): 'applied' | 'shape-mismatch' | 'invalid-links' | 'connection-refused' {
  const nodes = definition.nodes ?? []
  if (
    graph._nodes.length !== nodes.length ||
    new Set(nodes.map((node) => String(node.id))).size !== nodes.length ||
    !isEqual(portShape(graph.inputs), portShape(definition.inputs ?? [])) ||
    !isEqual(portShape(graph.outputs), portShape(definition.outputs ?? [])) ||
    nodes.some((source) => {
      const live = graph.getNodeById(toNodeId(source.id))
      return (
        !live ||
        live.type !== source.type ||
        !isEqual(portShape(live.inputs), portShape(source.inputs ?? [])) ||
        !isEqual(portShape(live.outputs), portShape(source.outputs ?? []))
      )
    })
  )
    return 'shape-mismatch'

  const ids = new Set<number>()
  const targets = new Set<string>()
  for (const {
    id,
    origin_id: originId,
    origin_slot: originSlot,
    target_id: targetId,
    target_slot: targetSlot
  } of definition.links ?? []) {
    const origin = graph.getNodeById(toNodeId(originId))
    const target = graph.getNodeById(toNodeId(targetId))
    const output =
      toNodeId(originId) === graph.inputNode.id
        ? graph.inputs[originSlot]
        : origin?.outputs[originSlot]
    const input =
      toNodeId(targetId) === graph.outputNode.id
        ? graph.outputs[targetSlot]
        : target?.inputs[targetSlot]
    const key = JSON.stringify([targetId, targetSlot])
    if (
      !Number.isSafeInteger(id) ||
      id < 1 ||
      !Number.isSafeInteger(originSlot) ||
      !Number.isSafeInteger(targetSlot) ||
      ids.has(id) ||
      targets.has(key) ||
      !output ||
      !input ||
      !LiteGraph.isValidConnection(output.type, input.type) ||
      (!origin && !target) ||
      [...graph.rootGraph.subgraphs.values(), graph.rootGraph].some(
        (other) => other !== graph && other.links.has(toLinkId(id))
      )
    )
      return 'invalid-links'
    ids.add(id)
    targets.add(key)
  }

  const desired = new Map(
    (definition.links ?? []).map((link) => [link.id, link])
  )
  const existing = [...graph.links.values()]
  for (const link of existing) {
    const source = desired.get(link.id)
    if (
      !source ||
      link.origin_id !== toNodeId(source.origin_id) ||
      link.origin_slot !== source.origin_slot ||
      link.target_id !== toNodeId(source.target_id) ||
      link.target_slot !== source.target_slot ||
      link.type !== source.type
    ) {
      if (link.target_id === graph.outputNode.id)
        graph.outputs[link.target_slot].disconnect()
      else graph.removeLink(link.id)
    }
  }

  for (const {
    id,
    origin_id: originId,
    origin_slot: originSlot,
    target_id: targetId,
    target_slot: targetSlot
  } of definition.links ?? []) {
    if (graph.links.has(toLinkId(id))) continue
    const origin = graph.getNodeById(toNodeId(originId))
    const target = graph.getNodeById(toNodeId(targetId))
    const previous = graph.state.lastLinkId
    graph.state.lastLinkId = toLinkId(id - 1)
    try {
      if (toNodeId(originId) === graph.inputNode.id && target) {
        graph.inputs[originSlot].connect(target.inputs[targetSlot], target)
      } else if (toNodeId(targetId) === graph.outputNode.id && origin) {
        graph.outputs[targetSlot].connect(origin.outputs[originSlot], origin)
      } else if (origin && target) {
        origin.connect(originSlot, target, targetSlot)
      }
    } finally {
      graph.state.lastLinkId = toLinkId(
        Math.max(previous, graph.state.lastLinkId)
      )
    }
    const connected = graph.links.get(toLinkId(id))
    if (
      !connected ||
      connected.origin_id !== toNodeId(originId) ||
      connected.origin_slot !== originSlot ||
      connected.target_id !== toNodeId(targetId) ||
      connected.target_slot !== targetSlot
    )
      return 'connection-refused'
  }
  return 'applied'
}
