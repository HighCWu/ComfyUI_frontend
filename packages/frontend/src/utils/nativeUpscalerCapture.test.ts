import { assert, expect, it } from 'vitest'

import { LGraph, LiteGraph } from '@/lib/litegraph/src/litegraph'
import type { ComfyNodeDef } from '@/schemas/nodeDefSchema'
import { useLitegraphService } from '@/services/litegraphService'

import { graphToPrompt } from './executionUtil'

const definitions: Record<string, ComfyNodeDef> = {
  UpscaleModelLoader: {
    name: 'UpscaleModelLoader',
    display_name: 'Load Upscale Model',
    category: 'model/loaders',
    python_module: 'comfy_extras.nodes_upscale_model',
    description: '',
    input: { required: { model_name: ['COMBO', { options: [] }] } },
    output: ['UPSCALE_MODEL'],
    output_name: ['UPSCALE_MODEL'],
    output_node: false
  },
  EmptyImage: {
    name: 'EmptyImage',
    display_name: 'Empty Image',
    category: 'image',
    python_module: 'nodes',
    description: '',
    input: {
      required: {
        width: ['INT', { default: 512, min: 1, max: 16384 }],
        height: ['INT', { default: 512, min: 1, max: 16384 }],
        batch_size: ['INT', { default: 1, min: 1, max: 4096 }],
        color: ['INT', { default: 0, min: 0, max: 16777215, display: 'color' }]
      }
    },
    output: ['IMAGE'],
    output_name: ['IMAGE'],
    output_node: false
  },
  ImageUpscaleWithModel: {
    name: 'ImageUpscaleWithModel',
    display_name: 'Upscale Image (using Model)',
    category: 'image/upscaling',
    python_module: 'comfy_extras.nodes_upscale_model',
    description: '',
    input: {
      required: { upscale_model: ['UPSCALE_MODEL', {}], image: ['IMAGE', {}] }
    },
    output: ['IMAGE'],
    output_name: ['IMAGE'],
    output_node: false
  },
  ImageScale: {
    name: 'ImageScale',
    display_name: 'Upscale Image',
    category: 'image/upscaling',
    python_module: 'nodes',
    description: '',
    input: {
      required: {
        image: ['IMAGE', {}],
        upscale_method: [
          ['nearest-exact', 'bilinear', 'area', 'bicubic', 'lanczos']
        ],
        width: ['INT', { default: 512, min: 0, max: 16384 }],
        height: ['INT', { default: 512, min: 0, max: 16384 }],
        crop: [['disabled', 'center']]
      }
    },
    output: ['IMAGE'],
    output_name: ['IMAGE'],
    output_node: false
  },
  SaveImage: {
    name: 'SaveImage',
    display_name: 'Save Image',
    category: 'image',
    python_module: 'nodes',
    description: '',
    input: {
      required: {
        images: ['IMAGE', {}],
        filename_prefix: ['STRING', { default: 'ComfyUI' }]
      }
    },
    output: ['IMAGE'],
    output_name: ['images'],
    output_node: true
  }
}

it('captures the actual five-node upscaler layout and connected prompt', async () => {
  for (const [name, definition] of Object.entries(definitions)) {
    await useLitegraphService().registerNodeDef(name, definition)
  }
  const graph = new LGraph()
  const nodes = [
    'UpscaleModelLoader',
    'EmptyImage',
    'ImageUpscaleWithModel',
    'ImageScale',
    'SaveImage'
  ].map((name) => {
    const node = LiteGraph.createNode(name)
    assert.exists(node)
    graph.add(node)
    return node
  })
  assert.exists(nodes[0])
  assert.exists(nodes[1])
  assert.exists(nodes[2])
  assert.exists(nodes[3])
  assert.exists(nodes[4])
  expect(nodes.map((node) => node.serialize().widgets_values)).toEqual([
    [null],
    [512, 512, 1, 0],
    undefined,
    ['nearest-exact', 512, 512, 'disabled'],
    ['ComfyUI']
  ])
  nodes[0].widgets![0].value = 'fixed-model.pth'
  for (const [index, value] of [8, 8, 1, 0x336699].entries())
    nodes[1].widgets![index].value = value
  for (const [index, value] of ['nearest-exact', 8, 8, 'disabled'].entries())
    nodes[3].widgets![index].value = value
  nodes[4].widgets![0].value = 'staging_real_model_pool'
  expect(nodes[0].connect(0, nodes[2], 0)).not.toBeNull()
  expect(nodes[1].connect(0, nodes[2], 1)).not.toBeNull()
  expect(nodes[2].connect(0, nodes[3], 0)).not.toBeNull()
  expect(nodes[3].connect(0, nodes[4], 0)).not.toBeNull()
  const snapshot = graph.serialize()
  const { output } = await graphToPrompt(graph)
  expect(
    snapshot.nodes.map((node) => ({
      type: node.type,
      inputs: node.inputs?.map((input) => [
        input.name,
        input.type,
        input.widget?.name ?? null
      ]),
      widgets: node.widgets_values
    }))
  ).toEqual([
    {
      type: 'UpscaleModelLoader',
      inputs: [['model_name', 'COMBO', 'model_name']],
      widgets: ['fixed-model.pth']
    },
    {
      type: 'EmptyImage',
      inputs: [
        ['width', 'INT', 'width'],
        ['height', 'INT', 'height'],
        ['batch_size', 'INT', 'batch_size'],
        ['color', 'INT', 'color']
      ],
      widgets: [8, 8, 1, 0x336699]
    },
    {
      type: 'ImageUpscaleWithModel',
      inputs: [
        ['upscale_model', 'UPSCALE_MODEL', null],
        ['image', 'IMAGE', null]
      ],
      widgets: undefined
    },
    {
      type: 'ImageScale',
      inputs: [
        ['image', 'IMAGE', null],
        ['upscale_method', 'COMBO', 'upscale_method'],
        ['width', 'INT', 'width'],
        ['height', 'INT', 'height'],
        ['crop', 'COMBO', 'crop']
      ],
      widgets: ['nearest-exact', 8, 8, 'disabled']
    },
    {
      type: 'SaveImage',
      inputs: [
        ['images', 'IMAGE', null],
        ['filename_prefix', 'STRING', 'filename_prefix']
      ],
      widgets: ['staging_real_model_pool']
    }
  ])
  expect(output[String(nodes[0].id)].inputs).toEqual({
    model_name: 'fixed-model.pth'
  })
  expect(output[String(nodes[1].id)].inputs).toEqual({
    width: 8,
    height: 8,
    batch_size: 1,
    color: 0x336699
  })
  expect(output[String(nodes[2].id)].inputs).toEqual({
    upscale_model: [String(nodes[0].id), 0],
    image: [String(nodes[1].id), 0]
  })
  expect(output[String(nodes[3].id)].inputs).toMatchObject({
    width: 8,
    height: 8,
    crop: 'disabled'
  })
  expect(output[String(nodes[4].id)].inputs).toEqual({
    filename_prefix: 'staging_real_model_pool',
    images: [String(nodes[3].id), 0]
  })
})
