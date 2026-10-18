import { assert, expect, it, onTestFinished } from 'vitest'

import {
  LGraph,
  LGraphNode,
  LiteGraph,
  SubgraphNode
} from '@/lib/litegraph/src/litegraph'
import { enableSubgraphNodeCreation } from '@/lib/litegraph/src/subgraph/__fixtures__/subgraphHelpers'
import { toNodeId } from '@/types/nodeId'
import { AgentCrdtProjection } from '@/workbench/extensions/agent/crdt/agentCrdtProjection'
import { FollowerDoc } from '@/workbench/extensions/agent/crdt/followerDoc'
import type { GraphOperation } from '@/workbench/extensions/agent/crdt/graphOperations'
import { mintWireOps } from '@/workbench/extensions/agent/crdt/opEnvelope'

import fixture from './__fixtures__/native-subgraph-host.json'
import { graphToPrompt } from './executionUtil'

class NativeProbe extends LGraphNode {
  constructor() {
    super('NativeProbe')
    this.comfyClass = 'NativeProbe'
    this.serialize_widgets = true
    this.addInput('value', 'FLOAT').widget = { name: 'value' }
    this.addWidget('number', 'value', 1, () => {})
    this.addOutput('value', 'FLOAT')
  }
}

class NativeOutput extends LGraphNode {
  constructor() {
    super('NativeOutput')
    this.comfyClass = 'NativeOutput'
    this.addInput('value', 'FLOAT')
  }
}

function loadBackendDocument(snapshot: string, expectedFailures = 0) {
  const graph = new LGraph()
  const restoreCreation = enableSubgraphNodeCreation(graph)
  const follower = new FollowerDoc()
  const projection = new AgentCrdtProjection(() => graph)
  projection.bind('subgraph-workflow', follower)
  onTestFinished(() => {
    projection.destroy()
    follower.destroy()
    restoreCreation()
  })
  const update = Uint8Array.from(atob(snapshot), (character) =>
    character.charCodeAt(0)
  )
  follower.applyRemoteUpdate(update)
  expect(
    projection.applyFrame({ workflowId: 'subgraph-workflow', seq: 1, update })
  ).toMatchObject({ applied: true, failureCount: expectedFailures })
  return { graph, follower, projection }
}

function registerProbeNodes() {
  LiteGraph.registerNodeType('NativeProbe', NativeProbe)
  LiteGraph.registerNodeType('NativeOutput', NativeOutput)
}

function resolveInteriorNode(host: SubgraphNode, path: readonly string[]) {
  return path.slice(1).reduce<LGraphNode>((parent, id) => {
    assert.instanceOf(parent, SubgraphNode)
    const node = parent.subgraph.getNodeById(toNodeId(id))
    assert.exists(node)
    return node
  }, host)
}

function resolvedPath(path: readonly string[]): [string, ...string[]] {
  assert.exists(path[0])
  return [path[0], ...path.slice(1)]
}

it.for(fixture.interior)(
  'protects pending $name interior edits and reverts only their exact target after refusal',
  (sample) => {
    registerProbeNodes()
    const { graph, follower, projection } = loadBackendDocument(sample.snapshot)
    const host = graph.getNodeById(toNodeId(1))
    assert.instanceOf(host, SubgraphNode)
    const edit = sample.edits[0]
    const leaf = resolveInteriorNode(host, edit.operation.path)
    assert.exists(leaf.widgets)
    const local: GraphOperation = {
      op: 'set_widget',
      node_id: 7,
      widget: 'value',
      inner_widget: 'value',
      path: resolvedPath(edit.operation.path),
      value: 999
    }
    leaf.widgets[0].value = 999
    projection.noteLocalWrites([local])
    const update = Uint8Array.from(atob(edit.delta), (character) =>
      character.charCodeAt(0)
    )
    follower.applyRemoteUpdate(update)
    expect(
      projection.applyFrame({ workflowId: 'subgraph-workflow', seq: 2, update })
    ).toMatchObject({ applied: true, failureCount: 0 })
    expect(leaf.widgets[0].value).toBe(999)
    projection.settleLocalWrites([local])
    expect(
      projection.revertRejected(
        'subgraph-workflow',
        mintWireOps([local], { actor: 'human:owner:tab', baseVersion: 2 })
      )
    ).toMatchObject({ applied: true, failureCount: 0 })
    expect(leaf.widgets[0].value).toBe(73)
    expect(
      graph.getNodeById(toNodeId(30))?.widgets?.map(({ value }) => value)
    ).toEqual([55])
  }
)

it.for(fixture.interior)(
  'settles an echoed local $name interior edit before the next remote update',
  (sample) => {
    registerProbeNodes()
    const { graph, follower, projection } = loadBackendDocument(sample.snapshot)
    const host = graph.getNodeById(toNodeId(1))
    assert.instanceOf(host, SubgraphNode)
    const leaf = resolveInteriorNode(host, sample.edits[0].operation.path)
    assert.exists(leaf.widgets)
    leaf.widgets[0].value = 73
    projection.noteLocalWrites([
      {
        op: 'set_widget',
        node_id: 7,
        widget: 'value',
        inner_widget: 'value',
        path: resolvedPath(sample.edits[0].operation.path),
        value: 73
      }
    ])
    follower.applyRemoteUpdate(
      Uint8Array.from(atob(sample.edits[0].delta), (character) =>
        character.charCodeAt(0)
      )
    )
    projection.discardPending('subgraph-workflow')
    const update = Uint8Array.from(atob(sample.edits[1].delta), (character) =>
      character.charCodeAt(0)
    )
    follower.applyRemoteUpdate(update)
    expect(
      projection.applyFrame({ workflowId: 'subgraph-workflow', seq: 3, update })
    ).toMatchObject({ applied: true, failureCount: 0 })
    expect(leaf.widgets[0].value).toBe(1)
  }
)

it.for(
  fixture.interior.flatMap((sample) =>
    sample.edits.map((edit, index) => ({
      ...edit,
      name: sample.name,
      initial: index === 0 ? sample.snapshot : sample.edits[index - 1].snapshot,
      sequence: index + 2,
      expected: [73, 1][index]
    }))
  )
)(
  'projects $name interior widget edit at sequence $sequence and restores equivalent execution',
  async ({ initial, sequence, operation, delta, snapshot, api, expected }) => {
    registerProbeNodes()
    const { graph, follower, projection } = loadBackendDocument(initial)
    const host = graph.getNodeById(toNodeId(1))
    const unrelated = graph.getNodeById(toNodeId(30))
    assert.instanceOf(host, SubgraphNode)
    assert.exists(unrelated)
    const definition = host.subgraph
    const leaf = resolveInteriorNode(host, operation.path)
    const update = Uint8Array.from(atob(delta), (character) =>
      character.charCodeAt(0)
    )
    follower.applyRemoteUpdate(update)
    expect(
      projection.applyFrame({
        workflowId: 'subgraph-workflow',
        seq: sequence,
        update,
        actor: operation.actor,
        opIds: [operation.op_id]
      })
    ).toMatchObject({ applied: true, failureCount: 0 })
    expect(graph.getNodeById(toNodeId(1))).toBe(host)
    expect(host.subgraph).toBe(definition)
    expect(resolveInteriorNode(host, operation.path)).toBe(leaf)
    expect(leaf.widgets?.map(({ value }) => value)).toEqual([expected])
    expect(graph.getNodeById(toNodeId(30))).toBe(unrelated)
    expect(unrelated.widgets?.map(({ value }) => value)).toEqual([55])
    const { output } = await graphToPrompt(graph)
    expect(
      Object.fromEntries(
        Object.entries(output).map(([id, node]) => [
          id,
          { class_type: node.class_type, inputs: node.inputs }
        ])
      )
    ).toEqual(api)
    const { graph: restored } = loadBackendDocument(snapshot)
    expect((await graphToPrompt(restored)).output).toEqual(output)
  }
)

it('rolls back a failed interior widget hook and reports a degraded frame without changing unrelated nodes', () => {
  registerProbeNodes()
  const sample = fixture.interior[0]
  const edit = sample.edits[0]
  const { graph, follower, projection } = loadBackendDocument(sample.snapshot)
  const host = graph.getNodeById(toNodeId(1))
  assert.instanceOf(host, SubgraphNode)
  const leaf = resolveInteriorNode(host, edit.operation.path)
  assert.exists(leaf.widgets)
  const widget = leaf.widgets[0]
  widget.callback = () => {
    throw new Error('Interior widget hook rejected the update')
  }
  const update = Uint8Array.from(atob(edit.delta), (character) =>
    character.charCodeAt(0)
  )
  follower.applyRemoteUpdate(update)
  expect(
    projection.applyFrame({ workflowId: 'subgraph-workflow', seq: 2, update })
  ).toMatchObject({ applied: true, failureCount: 1 })
  expect(widget.value).toBe(1)
  expect(
    graph.getNodeById(toNodeId(30))?.widgets?.map(({ value }) => value)
  ).toEqual([55])
})

it.for(
  fixture.linkEdits.map((edit, index) => ({
    ...edit,
    initial:
      index === 0 ? fixture.snapshot : fixture.linkEdits[index - 1].snapshot,
    sequence: index + 2
  }))
)(
  'projects backend subgraph $operation.op at sequence $sequence and restores equivalent execution',
  async ({ initial, sequence, operation, delta, snapshot, api }) => {
    registerProbeNodes()
    const { graph, follower, projection } = loadBackendDocument(initial)
    const host = graph.getNodeById(toNodeId(1))
    const sibling = graph.getNodeById(toNodeId(2))
    assert.instanceOf(host, SubgraphNode)
    assert.instanceOf(sibling, SubgraphNode)
    const definition = host.subgraph
    const update = Uint8Array.from(atob(delta), (character) =>
      character.charCodeAt(0)
    )
    follower.applyRemoteUpdate(update)
    expect(
      projection.applyFrame({
        workflowId: 'subgraph-workflow',
        seq: sequence,
        update,
        actor: operation.actor,
        opIds: [operation.op_id]
      })
    ).toMatchObject({ applied: true, failureCount: 0 })
    expect(graph.getNodeById(toNodeId(1))).toBe(host)
    expect(graph.getNodeById(toNodeId(2))).toBe(sibling)
    expect(host.subgraph).toBe(definition)
    expect(sibling.subgraph).toBe(definition)
    expect(host.widgets.map(({ value }) => value)).toEqual([42])
    expect(sibling.widgets.map(({ value }) => value)).toEqual([99])
    const { output } = await graphToPrompt(graph)
    expect(
      Object.fromEntries(
        Object.entries(output).map(([id, node]) => [
          id,
          { class_type: node.class_type, inputs: node.inputs }
        ])
      )
    ).toEqual(api)
    const { graph: restored } = loadBackendDocument(snapshot)
    expect((await graphToPrompt(restored)).output).toEqual(output)
  }
)

it('exposes original Follower degradation for an omitted earlier host input instead of treating it as a valid execution witness', () => {
  registerProbeNodes()
  const { graph } = loadBackendDocument(
    fixture.normalizationRequired.snapshot,
    2
  )
  expect(graph.nodes.map((node) => node.id)).toEqual(['1', '2', '20'])
})

it.for(['*', 'INT,FLOAT'])(
  'keeps a concrete host bypass independent of an unused %s input',
  async (type) => {
    registerProbeNodes()
    const { graph } = loadBackendDocument(fixture.snapshot)
    const host = graph.getNodeById(toNodeId(1))
    const source = graph.getNodeById(toNodeId(2))
    assert.instanceOf(host, SubgraphNode)
    assert.instanceOf(source, SubgraphNode)
    host.subgraph.addInput('unused', type)
    expect(source.connect(0, host, 0)).not.toBeNull()
    host.mode = 4
    const { output } = await graphToPrompt(graph)
    expect(output['20'].inputs).toEqual({ value: ['2:7', 0] })
    expect(output['1:7']).toBeUndefined()
  }
)

it.for(fixture.samples)(
  'matches backend-expanded prompt semantics for $name',
  async ({ snapshot, api }) => {
    registerProbeNodes()
    const { graph } = loadBackendDocument(snapshot)
    const { output } = await graphToPrompt(graph)
    expect(
      Object.fromEntries(
        Object.entries(output).map(([id, node]) => [
          id,
          { class_type: node.class_type, inputs: node.inputs }
        ])
      )
    ).toEqual(api)
  }
)

it.for([
  {
    name: 'direct',
    snapshot: () => fixture.snapshot,
    expected: {
      '1:7': { class_type: 'NativeProbe', inputs: { value: 42 } },
      '2:7': { class_type: 'NativeProbe', inputs: { value: 99 } },
      '20': { class_type: 'NativeOutput', inputs: { value: ['1:7', 0] } }
    }
  },
  {
    name: 'nested with colliding interior IDs remapped by LiteGraph',
    snapshot: () => fixture.nested.snapshot,
    expected: {
      '1:8:7': { class_type: 'NativeProbe', inputs: { value: 42 } },
      '2:8:7': { class_type: 'NativeProbe', inputs: { value: 99 } },
      '20': { class_type: 'NativeOutput', inputs: { value: ['1:8:7', 0] } }
    }
  }
])(
  'reconstructs $name backend subgraphs with instance-local promoted values and equivalent execution after refresh',
  async ({ snapshot, expected }) => {
    registerProbeNodes()
    const { graph: first } = loadBackendDocument(snapshot())
    const firstHost = first.getNodeById(toNodeId(1))
    const secondHost = first.getNodeById(toNodeId(2))
    assert.instanceOf(firstHost, SubgraphNode)
    assert.instanceOf(secondHost, SubgraphNode)
    expect(firstHost.widgets.map(({ value }) => value)).toEqual([42])
    expect(secondHost.widgets.map(({ value }) => value)).toEqual([99])
    expect(firstHost.subgraph).toBe(secondHost.subgraph)
    const { output } = await graphToPrompt(first)
    expect(
      Object.fromEntries(
        Object.entries(output).map(([id, node]) => [
          id,
          { class_type: node.class_type, inputs: node.inputs }
        ])
      )
    ).toEqual(expected)
    const { graph: refreshed } = loadBackendDocument(snapshot())
    expect((await graphToPrompt(refreshed)).output).toEqual(output)
  }
)

it('applies a backend promoted-value delta without replacing the host or changing another instance, and restores it after refresh', async () => {
  registerProbeNodes()
  const { graph, follower, projection } = loadBackendDocument(fixture.snapshot)
  const host = graph.getNodeById(toNodeId(1))
  assert.instanceOf(host, SubgraphNode)
  const update = Uint8Array.from(
    atob(fixture.promotedEdit.delta),
    (character) => character.charCodeAt(0)
  )
  follower.applyRemoteUpdate(update)
  expect(
    projection.applyFrame({
      workflowId: 'subgraph-workflow',
      seq: 2,
      update,
      actor: fixture.promotedEdit.operation.actor,
      opIds: [fixture.promotedEdit.operation.op_id]
    })
  ).toMatchObject({ applied: true, failureCount: 0 })
  expect(graph.getNodeById(toNodeId(1))).toBe(host)
  expect(host.widgets.map(({ value }) => value)).toEqual([73])
  const sibling = graph.getNodeById(toNodeId(2))
  assert.instanceOf(sibling, SubgraphNode)
  expect(sibling.widgets.map(({ value }) => value)).toEqual([99])
  const { output } = await graphToPrompt(graph)
  expect(
    Object.fromEntries(
      Object.entries(output).map(([id, node]) => [
        id,
        { class_type: node.class_type, inputs: node.inputs }
      ])
    )
  ).toEqual(fixture.promotedEdit.api)
  const { graph: restored } = loadBackendDocument(fixture.promotedEdit.snapshot)
  expect((await graphToPrompt(restored)).output).toEqual(output)
})
