import { expect, it } from 'vitest'

import {
  LGraph,
  LGraphEventMode,
  LGraphNode
} from '@/lib/litegraph/src/litegraph'

import { graphToPrompt } from './executionUtil'

it.for([true, false])(
  'retains only a serializable widget value when its wired source is muted (serialize=%s)',
  async (serialize) => {
    const graph = new LGraph()
    const source = new LGraphNode('Source')
    source.comfyClass = 'Source'
    source.addOutput('data', 'STRING')
    graph.add(source)
    const target = new LGraphNode('Output')
    target.comfyClass = 'Output'
    target.addInput('data', 'STRING')
    target.addWidget('text', 'data', 'fallback', () => undefined, {
      serialize
    })
    graph.add(target)
    source.connect(0, target, 0)
    source.mode = LGraphEventMode.NEVER

    const { output } = await graphToPrompt(graph)
    expect(output[String(source.id)]).toBeUndefined()
    expect(output[String(target.id)].inputs).toEqual(
      serialize ? { data: 'fallback' } : {}
    )
    expect(graph.getNodeById(source.id)?.mode).toBe(LGraphEventMode.NEVER)
  }
)
