import { assert, expect, it } from 'vitest'

import { LGraph, LGraphNode } from '@/lib/litegraph/src/litegraph'
import { transformInputSpecV1ToV2 } from '@/schemas/nodeDef/migration'
import { zDynamicComboInputSpec } from '@/schemas/nodeDefSchema'
import { useLitegraphService } from '@/services/litegraphService'
import { toLinkId } from '@/types/linkId'
import { AgentCrdtProjection } from '@/workbench/extensions/agent/crdt/agentCrdtProjection'
import { FollowerDoc } from '@/workbench/extensions/agent/crdt/followerDoc'

import spec from './__fixtures__/native-dynamic-execution.json'
import fixture from './__fixtures__/native-dynamic-host-frames.json'
import { graphToPrompt } from './executionUtil'

async function applyHostFrames(
  projection: AgentCrdtProjection,
  follower: FollowerDoc,
  graph: LGraph,
  node: LGraphNode
) {
  const observed = []
  for (const frame of fixture.frames) {
    const update = Uint8Array.from(atob(frame.update), (character) =>
      character.charCodeAt(0)
    )
    follower.applyRemoteUpdate(update)
    const outcome = projection.applyFrame({
      workflowId: 'dynamic-workflow',
      seq: frame.seq,
      update,
      actor: frame.op.actor,
      opIds: [frame.op.op_id]
    })
    const { output } = await graphToPrompt(graph)
    observed.push({
      applied: outcome.applied,
      failureCount: outcome.applied ? outcome.failureCount : null,
      api: Object.fromEntries(
        Object.entries(output).map(([id, { class_type, inputs }]) => [
          id,
          { class_type, inputs }
        ])
      ),
      sameNode: graph.getNodeById(node.id) === node,
      removedLinkPresent: graph.links.has(toLinkId(1))
    })
  }
  return observed
}

it('applies backend-produced selector deltas without reset, stale links or lost branch values', async () => {
  const graph = new LGraph()
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
  const follower = new FollowerDoc()
  const projection = new AgentCrdtProjection(() => graph)
  projection.bind('dynamic-workflow', follower)
  try {
    const snapshot = Uint8Array.from(
      atob(fixture.initialSnapshot),
      (character) => character.charCodeAt(0)
    )
    follower.applyRemoteUpdate(snapshot)
    expect(
      projection.applyFrame({
        workflowId: 'dynamic-workflow',
        seq: 1,
        update: snapshot,
        actor: 'agent:thread:turn',
        opIds: []
      })
    ).toMatchObject({ applied: true, failureCount: 0 })
    expect(await applyHostFrames(projection, follower, graph, node)).toEqual(
      fixture.frames.map((frame) => ({
        applied: true,
        failureCount: 0,
        api: frame.api,
        sameNode: true,
        removedLinkPresent: false
      }))
    )
    expect(node.widgets.map(({ name, value }) => [name, value])).toEqual([
      ['mode', 'text'],
      ['mode.steps', 11],
      ['mode.suffix', 'tail']
    ])
  } finally {
    projection.destroy()
    follower.destroy()
  }
})
