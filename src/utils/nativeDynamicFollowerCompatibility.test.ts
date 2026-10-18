import { applyOps, mint, project } from '@comfyorg/comfy-multi-player'
import type { WidgetCatalog } from '@comfyorg/comfy-multi-player'
import { assert, expect, it } from 'vitest'
import * as Y from 'yjs'

import { LGraph, LGraphNode } from '@/lib/litegraph/src/litegraph'
import { transformInputSpecV1ToV2 } from '@/schemas/nodeDef/migration'
import { zDynamicComboInputSpec } from '@/schemas/nodeDefSchema'
import { useLitegraphService } from '@/services/litegraphService'
import { AgentCrdtProjection } from '@/workbench/extensions/agent/crdt/agentCrdtProjection'
import { FollowerDoc } from '@/workbench/extensions/agent/crdt/followerDoc'

import fixture from './__fixtures__/native-dynamic-execution.json'
import { graphToPrompt } from './executionUtil'

it('keeps document link intent separate from links removed by a live selector callback', async () => {
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
        fixture.object_info.DynamicExample.input.required.mode
      ),
      { name: 'mode', isOptional: false }
    )
  )
  assert.exists(node.widgets?.[0])
  node.widgets[0].value = 'image'
  graph.add(node)
  const link = source.connect(0, node, 1)
  assert.exists(link)
  const saved = graph.serialize()
  const catalogue: WidgetCatalog = {
    types: { Source: { widget_order: [] }, DynamicExample: fixture.metadata }
  }
  const host = mint(
    {
      ...saved,
      nodes: saved.nodes.map(({ flags, ...node }) => ({
        ...node,
        flags: { ...flags }
      }))
    },
    catalogue
  )
  const follower = new FollowerDoc()
  const projection = new AgentCrdtProjection(() => graph)
  projection.bind('dynamic-workflow', follower)
  try {
    follower.applyRemoteUpdate(Y.encodeStateAsUpdate(host))
    expect(
      projection.applyFrame({
        workflowId: 'dynamic-workflow',
        seq: 1,
        update: Y.encodeStateAsUpdate(host),
        actor: 'agent:host:turn',
        opIds: []
      })
    ).toMatchObject({ applied: true, failureCount: 0 })
    const vector = Y.encodeStateVector(host)
    const changed = applyOps(
      host,
      [
        {
          op: 'set_widget',
          op_id: 'a'.repeat(32),
          actor: 'agent:host:turn',
          stamp: [2, 'agent:host:turn'],
          base_version: 1,
          node_id: node.id,
          widget: 'mode',
          value: 'text'
        }
      ],
      catalogue
    )
    expect(changed.outcomes).toMatchObject([{ outcome: 'applied' }])
    const delta = Y.encodeStateAsUpdate(host, vector)
    follower.applyRemoteUpdate(delta)
    expect(
      projection.applyFrame({
        workflowId: 'dynamic-workflow',
        seq: 2,
        update: delta,
        actor: 'agent:host:turn',
        opIds: []
      })
    ).toMatchObject({ applied: true, failureCount: 0 })
    expect(node.inputs.map(({ name }) => name)).toEqual([
      'mode',
      'mode.steps',
      'mode.suffix'
    ])
    expect(graph.getLink(link.id)).toBeUndefined()
    expect(project(host, catalogue).links).toHaveLength(1)
    expect(
      project(host, catalogue).nodes.find(
        (entry) => String(entry.id) === String(node.id)
      )?.inputs
    ).toMatchObject([{ name: 'mode' }, { name: 'mode.image' }])
    expect((await graphToPrompt(graph)).output[String(node.id)].inputs).toEqual(
      { mode: 'text', 'mode.steps': 7, 'mode.suffix': 'tail' }
    )
    const secondVector = Y.encodeStateVector(host)
    expect(
      applyOps(
        host,
        [
          {
            op: 'set_widget',
            op_id: 'b'.repeat(32),
            actor: 'agent:host:turn',
            stamp: [3, 'agent:host:turn'],
            base_version: 2,
            node_id: node.id,
            widget: 'mode',
            value: 'image'
          }
        ],
        catalogue
      ).outcomes
    ).toMatchObject([{ outcome: 'applied' }])
    const secondDelta = Y.encodeStateAsUpdate(host, secondVector)
    follower.applyRemoteUpdate(secondDelta)
    expect(
      projection.applyFrame({
        workflowId: 'dynamic-workflow',
        seq: 3,
        update: secondDelta,
        actor: 'agent:host:turn',
        opIds: []
      })
    ).toMatchObject({ applied: true, failureCount: 0 })
    expect(node.inputs.map(({ name }) => name)).toEqual(['mode', 'mode.image'])
    expect(graph.getLink(link.id)).toBeUndefined()
    expect(project(host, catalogue).links).toHaveLength(1)
    expect((await graphToPrompt(graph)).output[String(node.id)].inputs).toEqual(
      { mode: 'image' }
    )

    const reconnectedFollower = new FollowerDoc()
    const reconnectedProjection = new AgentCrdtProjection(() => graph)
    reconnectedProjection.bind('dynamic-workflow', reconnectedFollower)
    try {
      const snapshot = Y.encodeStateAsUpdate(host)
      reconnectedFollower.applyRemoteUpdate(snapshot)
      expect(
        reconnectedProjection.applyFrame({
          workflowId: 'dynamic-workflow',
          seq: 3,
          update: snapshot,
          actor: 'agent:host:turn',
          opIds: []
        })
      ).toMatchObject({ applied: true, failureCount: 0 })
      expect(
        (await graphToPrompt(graph)).output[String(node.id)].inputs
      ).toEqual({ mode: 'image', 'mode.image': [String(source.id), 0] })
    } finally {
      reconnectedProjection.destroy()
      reconnectedFollower.destroy()
    }
  } finally {
    projection.destroy()
    follower.destroy()
    host.destroy()
  }
})
