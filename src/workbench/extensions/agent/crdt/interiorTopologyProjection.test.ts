import { assert, describe, expect, it, onTestFinished, vi } from 'vitest'
import * as Y from 'yjs'

import { LGraphNode } from '@/lib/litegraph/src/litegraph'
import {
  createTestSubgraph,
  createTestSubgraphNode
} from '@/lib/litegraph/src/subgraph/__fixtures__/subgraphHelpers'

import { projectInteriorLinks } from './interiorTopologyProjection'
import { DocChangeCollector } from './docChangeCollector'
import { LiveGraphApplier } from './liveGraphApplier'
import { AgentCrdtProjection } from './agentCrdtProjection'
import { FollowerDoc } from './followerDoc'

vi.mock(import('@/platform/telemetry/reportError'))

function fixture() {
  const graph = createTestSubgraph({
    inputs: [{ name: 'value', type: 'NUMBER' }],
    outputs: [{ name: 'result', type: 'NUMBER' }]
  })
  graph.rootGraph.subgraphs.set(graph.id, graph)
  const source = new LGraphNode('Source', 'Source')
  source.addOutput('value', 'NUMBER')
  graph.add(source)
  const target = new LGraphNode('Target', 'Target')
  target.addInput('first', 'NUMBER')
  target.addInput('second', 'NUMBER')
  target.addOutput('result', 'NUMBER')
  graph.add(target)
  source.connect(0, target, 0)
  graph.inputs[0].connect(target.inputs[1], target)
  graph.outputs[0].connect(target.outputs[0], target)
  return { graph, source, target }
}

describe('interior topology link projection', () => {
  it('retries held topology after the own echo catches up, without replaying unrelated root changes', () => {
    const { graph, source, target } = fixture()
    source.addWidget('number', 'value', 3, () => {})
    const widget = target.addWidget('number', 'value', 9, () => {})
    const host = createTestSubgraphNode(graph, { id: 10 })
    graph.rootGraph.add(host)
    const serialized = graph.asSerialisable()
    const doc = new Y.Doc()
    const follower = new FollowerDoc()
    const projection = new AgentCrdtProjection(() => graph.rootGraph)
    onTestFinished(() => {
      projection.destroy()
      follower.destroy()
      doc.destroy()
    })
    const widgets = new Y.Map([['value', 3]])
    assert.exists(serialized.links)
    const links = new Y.Map<unknown>(
      serialized.links.map((link) => [String(link.id), link])
    )
    const definition = new Y.Map<unknown>(Object.entries(serialized))
    definition.set(
      'nodes',
      new Y.Map(
        serialized.nodes.map((node) => [
          String(node.id),
          new Y.Map<unknown>([
            ...Object.entries(node),
            [
              'widgets',
              String(node.id) === target.id
                ? widgets
                : new Y.Map([['value', 3]])
            ]
          ])
        ])
      )
    )
    definition.set('links', links)
    doc.getMap('definitions').set(graph.id, definition)
    follower.applyRemoteUpdate(Y.encodeStateAsUpdate(doc))
    projection.bind('workflow', follower)
    projection.noteLocalWrites([
      {
        op: 'set_widget',
        node_id: target.id,
        widget: 'value',
        value: 9,
        path: [host.id, target.id],
        inner_widget: 'value'
      }
    ])
    links.clear()
    const update = Y.encodeStateAsUpdate(doc, follower.stateVector())
    follower.applyRemoteUpdate(update)
    expect(
      projection.applyFrame({ workflowId: 'workflow', seq: 1, update })
    ).toMatchObject({ applied: true, failureCount: 0 })
    expect(graph.links.size).toBe(3)
    expect(projection.retryDeferred('workflow')).toMatchObject({
      applied: true,
      failureCount: 0
    })
    expect(widget.value).toBe(9)
    expect(graph.links.size).toBe(3)

    widgets.set('value', 9)
    follower.applyRemoteUpdate(
      Y.encodeStateAsUpdate(doc, follower.stateVector())
    )
    projection.discardPending('workflow')
    expect(projection.retryDeferred('workflow')).toMatchObject({
      applied: true,
      failureCount: 0
    })
    expect(widget.value).toBe(9)
    expect(graph.links.size).toBe(0)
    expect(graph.rootGraph.getNodeById(host.id)).toBe(host)
    expect(projection.retryDeferred('workflow')).toMatchObject({
      applied: false
    })
  })

  it.for([
    { pending: false, failures: 0, linksRemaining: 0 },
    { pending: true, failures: 0, linksRemaining: 3 }
  ])(
    'projects collected topology with local-write pending=$pending',
    ({ pending, failures, linksRemaining }) => {
      const { graph, source, target } = fixture()
      source.addWidget('number', 'value', 3, () => {})
      target.addWidget('number', 'value', 3, () => {})
      const serialized = graph.asSerialisable()
      const doc = new Y.Doc()
      const collector = new DocChangeCollector(doc)
      onTestFinished(() => {
        collector.destroy()
        doc.destroy()
      })
      assert.exists(serialized.links)
      const links = new Y.Map<unknown>(
        serialized.links.map((link) => [String(link.id), link])
      )
      const definition = new Y.Map<unknown>(Object.entries(serialized))
      definition.set(
        'nodes',
        new Y.Map(
          serialized.nodes.map((node) => [
            String(node.id),
            new Y.Map<unknown>([
              ...Object.entries(node),
              ['widgets', new Y.Map([['value', 3]])]
            ])
          ])
        )
      )
      definition.set('links', links)
      doc.getMap('definitions').set(graph.id, definition)
      collector.discard()
      links.clear()
      const applier = new LiveGraphApplier({
        getGraph: () => graph.rootGraph,
        holdsLocalWrite: () => pending
      })
      const result = applier.applyChanges(doc, collector.take(), {
        actor: 'agent:test',
        opIds: ['remove-links']
      })
      expect(result.failureCount).toBe(failures)
      expect(graph.links.size).toBe(linksRemaining)
      expect(result.deferredInteriorTopology?.size ?? 0).toBe(Number(pending))
    }
  )

  it('restores ordinary and both boundary links without replacing nodes or layout', () => {
    const { graph, source, target } = fixture()
    const definition = structuredClone(graph.asSerialisable())
    target.pos = [71, 93]
    source.disconnectOutput(0)
    graph.inputs[0].disconnect()
    graph.outputs[0].disconnect()
    expect(graph.links.size).toBe(0)
    expect(projectInteriorLinks(graph, definition)).toBe('applied')
    expect(graph.asSerialisable().links).toEqual(definition.links)
    expect(graph.getNodeById(target.id)).toBe(target)
    expect([...target.pos]).toEqual([71, 93])
    expect(projectInteriorLinks(graph, definition)).toBe('applied')
    expect(graph.links.size).toBe(3)
  })

  it('removes stale links including boundary reverse references', () => {
    const { graph, target } = fixture()
    const definition = { ...graph.asSerialisable(), links: [] }
    expect(projectInteriorLinks(graph, definition)).toBe('applied')
    expect(graph.links.size).toBe(0)
    expect(graph.inputs[0].linkIds).toEqual([])
    expect(graph.outputs[0].linkIds).toEqual([])
    expect(target.inputs.map((input) => input.link)).toEqual([null, null])
  })

  it('projects a retained boundary connection after a dynamic input is removed', () => {
    const { graph, source, target } = fixture()
    const definition = structuredClone(graph.asSerialisable())
    const savedTarget = definition.nodes.find(
      (node) => String(node.id) === target.id
    )
    assert.exists(savedTarget)
    assert.exists(definition.links)
    savedTarget.inputs = savedTarget.inputs?.slice(1)
    definition.links = definition.links
      .filter((link) => String(link.origin_id) !== source.id)
      .map((link) =>
        String(link.target_id) === target.id
          ? { ...link, target_slot: 0 }
          : link
      )
    target.removeInput(0)
    expect(projectInteriorLinks(graph, definition)).toBe('applied')
    expect(new Set(graph.asSerialisable().links)).toEqual(
      new Set(definition.links)
    )
    expect(target.inputs.map((input) => input.name)).toEqual(['second'])
    expect(graph.inputs[0].linkIds).toEqual([2])
  })

  it('rejects a port mismatch before deleting any existing links', () => {
    const { graph } = fixture()
    const definition = structuredClone(graph.asSerialisable())
    const input = definition.nodes[1].inputs?.[0]
    assert.exists(input)
    input.name = 'changed'
    assert.exists(definition.links)
    definition.links = []
    expect(projectInteriorLinks(graph, definition)).toBe('shape-mismatch')
    expect(graph.links.size).toBe(3)
  })

  it('rejects a duplicate target before deleting any existing links', () => {
    const { graph } = fixture()
    const definition = structuredClone(graph.asSerialisable())
    assert.exists(definition.links)
    const link = definition.links[0]
    assert.exists(link)
    definition.links.push({ ...link, id: 100 })
    expect(projectInteriorLinks(graph, definition)).toBe('invalid-links')
    expect(graph.links.size).toBe(3)
  })
})
