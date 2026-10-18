import { expect, it } from 'vitest'
import { z } from 'zod'

import { LGraph, LGraphNode } from '@/lib/litegraph/src/litegraph'

import fixtures from './__fixtures__/native-bypass-cases.json'
import { graphToPrompt } from './executionUtil'

const cases = z
  .array(
    z.object({
      name: z.string(),
      target: z.number(),
      nodes: z.array(
        z.object({
          id: z.number(),
          mode: z.union([z.literal(0), z.literal(2), z.literal(4)]),
          inputs: z.array(z.string()),
          outputs: z.array(z.string()),
          widget: z
            .object({ value: z.string(), serialize: z.boolean() })
            .optional()
        })
      ),
      links: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])),
      expected_input: z.union([
        z.tuple([z.number(), z.number()]),
        z.string(),
        z.null()
      ]),
      expected_error: z.string().optional()
    })
  )
  .parse(fixtures)

it.for(cases)('serializes the original bypass rule: $name', async (fixture) => {
  const graph = new LGraph()
  const nodes = new Map(
    fixture.nodes.map((spec) => {
      const node = new LGraphNode(`Node${spec.id}`)
      node.comfyClass = `Node${spec.id}`
      spec.inputs.forEach((type, index) =>
        node.addInput(`input_${index}`, type)
      )
      spec.outputs.forEach((type, index) =>
        node.addOutput(`output_${index}`, type)
      )
      if (spec.widget)
        node.addWidget('text', 'input_0', spec.widget.value, () => undefined, {
          serialize: spec.widget.serialize
        })
      graph.add(node)
      return [spec.id, node] as const
    })
  )
  for (const [source, output, target, input] of fixture.links) {
    expect(
      nodes.get(source)!.connect(output, nodes.get(target)!, input)
    ).not.toBeNull()
  }
  for (const spec of fixture.nodes) nodes.get(spec.id)!.mode = spec.mode
  if (fixture.expected_error) {
    await expect(graphToPrompt(graph)).rejects.toThrow(/Circular reference/)
    return
  }
  const { output } = await graphToPrompt(graph)
  const expected = Array.isArray(fixture.expected_input)
    ? [
        String(nodes.get(fixture.expected_input[0])!.id),
        fixture.expected_input[1]
      ]
    : fixture.expected_input
  expect(output[String(nodes.get(fixture.target)!.id)].inputs).toEqual(
    expected === null ? {} : { input_0: expected }
  )
  for (const spec of fixture.nodes.filter((node) => node.mode !== 0)) {
    expect(output[String(nodes.get(spec.id)!.id)]).toBeUndefined()
  }
})
