import { assert, expect, it, onTestFinished } from 'vitest'
import * as Y from 'yjs'

import { LGraphNode } from '@/lib/litegraph/src/litegraph'
import type { Subgraph } from '@/lib/litegraph/src/litegraph'
import {
  createTestSubgraph,
  createTestSubgraphNode
} from '@/lib/litegraph/src/subgraph/__fixtures__/subgraphHelpers'
import { transformInputSpecV1ToV2 } from '@/schemas/nodeDef/migration'
import { zDynamicComboInputSpec } from '@/schemas/nodeDefSchema'
import { useLitegraphService } from '@/services/litegraphService'
import { toLinkId } from '@/types/linkId'
import { AgentCrdtProjection } from '@/workbench/extensions/agent/crdt/agentCrdtProjection'
import { FollowerDoc } from '@/workbench/extensions/agent/crdt/followerDoc'

import spec from './__fixtures__/native-dynamic-execution.json'
import fixture from './__fixtures__/native-interior-dynamic-host-frames.json'
import { graphToPrompt } from './executionUtil'

const decode = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0))

async function applyFrames(
  follower: FollowerDoc,
  projection: AgentCrdtProjection,
  graph: Subgraph,
  node: LGraphNode
) {
  const observed = []
  for (const frame of fixture.frames) {
    const update = decode(frame.update)
    follower.applyRemoteUpdate(update)
    const result = projection.applyFrame({
      workflowId: 'interior-dynamic',
      seq: frame.seq,
      update
    })
    const { output } = await graphToPrompt(graph.rootGraph)
    observed.push({
      failures: result.applied ? result.failureCount : -1,
      inputs: node.inputs.map((input) => input.name),
      api: output['10:2']?.inputs,
      sameNode: graph.getNodeById(node.id) === node,
      removedLinkPresent: graph.links.has(toLinkId(1))
    })
  }
  return observed
}

it('projects real dynamic widget callbacks inside a subgraph across selector round trips', async () => {
  const graph = createTestSubgraph({
    id: '11111111-1111-4111-8111-111111111111'
  })
  graph.rootGraph.subgraphs.set(graph.id, graph)
  const source = new LGraphNode('Source', 'Source')
  source.comfyClass = 'Source'
  source.addOutput('image', 'IMAGE')
  graph.add(source)
  const node = new LGraphNode('DynamicExample', 'DynamicExample')
  node.comfyClass = 'DynamicExample'
  node.serialize_widgets = true
  useLitegraphService().addNodeInput(
    node,
    transformInputSpecV1ToV2(
      zDynamicComboInputSpec.parse(
        spec.object_info.DynamicExample.input.required.mode
      ),
      { name: 'mode', isOptional: false }
    )
  )
  assert.exists(node.widgets?.[0])
  node.widgets[0].value = 'image'
  node.addInput('tail', 'IMAGE')
  graph.add(node)
  assert.exists(source.connect(0, node, 1))
  assert.exists(source.connect(0, node, 2))
  graph.rootGraph.add(createTestSubgraphNode(graph, { id: 10 }))
  const follower = new FollowerDoc()
  const projection = new AgentCrdtProjection(() => graph.rootGraph)
  onTestFinished(() => {
    projection.destroy()
    follower.destroy()
  })
  projection.bind('interior-dynamic', follower)
  const initial = decode(fixture.initialSnapshot)
  follower.applyRemoteUpdate(initial)
  expect(
    projection.applyFrame({
      workflowId: 'interior-dynamic',
      seq: 1,
      update: initial
    })
  ).toMatchObject({ applied: true, failureCount: 0 })

  const observed = await applyFrames(follower, projection, graph, node)
  expect(observed).toEqual(
    fixture.frames.map((frame) => ({
      failures: 0,
      inputs: frame.graph.definitions.subgraphs[0].nodes[1].inputs.map(
        (input) => input.name
      ),
      api: frame.api['10:2'].inputs,
      sameNode: true,
      removedLinkPresent: false
    }))
  )
  node.widgets[0].value = 'image'
  const reconnected = new FollowerDoc()
  const recovered = new AgentCrdtProjection(() => graph.rootGraph)
  onTestFinished(() => {
    recovered.destroy()
    reconnected.destroy()
  })
  recovered.bind('interior-dynamic', reconnected)
  const snapshot = Y.encodeStateAsUpdate(follower.doc)
  reconnected.applyRemoteUpdate(snapshot)
  expect(
    recovered.applyFrame({
      workflowId: 'interior-dynamic',
      seq: 5,
      update: snapshot
    })
  ).toMatchObject({ applied: true, failureCount: 0 })
  expect((await graphToPrompt(graph.rootGraph)).output['10:2'].inputs).toEqual({
    mode: 'text',
    'mode.steps': 11,
    'mode.suffix': 'tail',
    tail: ['10:1', 0]
  })
  expect(graph.getNodeById(node.id)).toBe(node)
  expect(graph.links.has(toLinkId(1))).toBe(false)
})
