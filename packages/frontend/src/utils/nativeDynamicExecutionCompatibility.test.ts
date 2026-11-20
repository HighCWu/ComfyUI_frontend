import { assert, expect, it } from 'vitest'

import { LGraph, LGraphNode } from '@/lib/litegraph/src/litegraph'
import { transformInputSpecV1ToV2 } from '@/schemas/nodeDef/migration'
import { zDynamicComboInputSpec } from '@/schemas/nodeDefSchema'
import { useLitegraphService } from '@/services/litegraphService'

import fixture from './__fixtures__/native-dynamic-execution.json'
import { graphToPrompt } from './executionUtil'

it.for(fixture.variants)(
  'matches the pinned dynamic $selection input slots and API widget names',
  async (variant) => {
    const graph = new LGraph()
    const node = new LGraphNode('DynamicExample')
    node.comfyClass = 'DynamicExample'
    const spec = zDynamicComboInputSpec.parse(
      fixture.object_info.DynamicExample.input.required.mode
    )
    useLitegraphService().addNodeInput(
      node,
      transformInputSpecV1ToV2(spec, { name: 'mode', isOptional: false })
    )
    assert.exists(node.widgets?.[0])
    node.widgets[0].value = variant.selection
    graph.add(node)

    expect(
      node.inputs.map(({ name, type, widget, shape }) => ({
        name,
        type,
        ...(widget ? { widget: { name: widget.name } } : {}),
        ...(shape ? { shape } : {}),
        link: null
      }))
    ).toEqual(variant.inputs)
    expect(node.widgets.map(({ name }) => name)).toEqual(variant.widget_order)
    expect(node.widgets.map(({ value }) => value)).toEqual(
      variant.widgets_values
    )
    const { output } = await graphToPrompt(graph)
    expect(output[String(node.id)].inputs).toEqual(variant.expected_api_inputs)
  }
)

it('serializes a concrete link under the selected dynamic input name', async () => {
  const graph = new LGraph()
  const source = new LGraphNode('Source')
  source.comfyClass = 'Source'
  source.addOutput('image', 'IMAGE')
  graph.add(source)
  const node = new LGraphNode('DynamicExample')
  node.comfyClass = 'DynamicExample'
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
  expect(source.connect(0, node, 1)).not.toBeNull()
  const { output } = await graphToPrompt(graph)
  expect(output[String(node.id)].inputs).toEqual({
    mode: 'image',
    'mode.image': [String(source.id), 0]
  })
})
