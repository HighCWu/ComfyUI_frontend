import { applyOps, mint, project } from '@comfyorg/comfy-multi-player'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi
} from 'vitest'

import { LGraph, LGraphNode, LiteGraph } from '@/lib/litegraph/src/litegraph'
import { reportError } from '@/platform/telemetry/reportError'

vi.mock(import('@/platform/telemetry/reportError'))

import type { GraphOperation } from './graphOperations'
import { wireNodeSnapshot } from './docOpMinter'
import { mintWireOps } from './opEnvelope'
import {
  attachRestoreOpMinter,
  notifyRestoreMintersAfterGraphConfigure,
  notifyRestoreMintersBeforeGraphLoad,
  notifyRestoreMintersGraphLoadError
} from './restoreOpMinter'
import type { RestoreOpMinter } from './restoreOpMinter'

class TestSource extends LGraphNode {
  constructor() {
    super('Test Source')
    this.addWidget('text', 'image', 'a.png', () => {})
    this.addOutput('image', 'IMAGE')
    this.serialize_widgets = true
  }
}

class TestSink extends LGraphNode {
  constructor() {
    super('Test Sink')
    this.addInput('image', 'IMAGE')
  }
}

beforeEach(() => {
  LiteGraph.registerNodeType('TestSource', TestSource)
  LiteGraph.registerNodeType('TestSink', TestSink)
})

/**
 * QAF-51: the ChangeTracker replays undo/redo through `app.loadGraphData`,
 * which litegraph runs under the `load` intent source, so the doc never learns
 * what the undo removed and the next remote frame re-materializes it. During
 * `_restoringState` the graph is diffed across the load bracket and the
 * supported subset is minted as semantic ops.
 */
describe('attachRestoreOpMinter', () => {
  let graph: LGraph
  let minted: GraphOperation[]
  let minter: RestoreOpMinter
  let restoring: boolean
  let bound: boolean
  let source: TestSource
  let sink: TestSink
  let docInputs: readonly (string | undefined)[] | null

  /** Run `mutate` as the ChangeTracker would: inside a graph load bracket. */
  function restoreThrough(mutate: () => void): void {
    notifyRestoreMintersBeforeGraphLoad()
    mutate()
    notifyRestoreMintersAfterGraphConfigure()
  }

  beforeEach(() => {
    graph = new LGraph()
    minted = []
    restoring = true
    bound = true
    docInputs = null
    source = new TestSource()
    sink = new TestSink()
    graph.add(source)
    graph.add(sink)
    sink.pos = [40, 0]
    source.connect(0, sink, 0)
    minter = attachRestoreOpMinter({
      isEnabled: () => true,
      isDocBound: () => bound,
      enqueue: (operations) => minted.push(...operations),
      getGraph: () => graph,
      docInputNames: () => docInputs,
      isRestoringState: () => restoring
    })
  })

  afterEach(() => minter.detach())

  it('mints the undone node deletion with the link it severed', () => {
    const linkId = sink.inputs[0].link
    restoreThrough(() => graph.remove(sink))

    expect(minted).toEqual([
      { op: 'delete_node', node_id: String(sink.id), removed_links: [linkId] }
    ])
  })

  it('mints the redone node as add_node followed by its connect', () => {
    graph.remove(sink)
    const restored = new TestSink()
    restored.id = sink.id

    restoreThrough(() => {
      graph.add(restored)
      restored.pos = [40, 0]
      source.connect(0, restored, 0)
    })

    expect(minted).toEqual([
      {
        op: 'add_node',
        node_id: String(sink.id),
        class_type: 'TestSink',
        pos: [40, 0],
        node: expect.objectContaining({ type: 'TestSink' })
      },
      {
        op: 'connect',
        link_id: restored.inputs[0].link,
        from_node: source.id,
        from_slot: 0,
        to_node: sink.id,
        to_slot: 0,
        link_type: 'IMAGE'
      }
    ])
  })

  it('maps a restored link target from live slot order to document order', () => {
    sink.addInput('prompt', 'STRING')
    docInputs = ['prompt', 'image']
    sink.disconnectInput(0)

    restoreThrough(() => source.connect(0, sink, 0))

    expect(minted).toEqual([
      expect.objectContaining({
        op: 'connect',
        to_node: sink.id,
        to_slot: 1
      })
    ])
  })

  it('mints a set_widget for a value the restore changed on a surviving node', () => {
    restoreThrough(() => {
      source.widgets![0].value = 'b.png'
    })

    expect(minted).toEqual([
      {
        op: 'set_widget',
        node_id: String(source.id),
        widget: 'image',
        value: 'b.png',
        old: 'a.png'
      }
    ])
  })

  it.for([
    {
      name: 'title',
      change: (node: LGraphNode) => {
        node.title = 'Restored title'
      },
      field: 'title',
      value: 'Restored title'
    },
    {
      name: 'execution mode',
      change: (node: LGraphNode) => {
        node.mode = 4
      },
      field: 'mode',
      value: 4
    },
    {
      name: 'collapsed state',
      change: (node: LGraphNode) => {
        node.flags.collapsed = true
      },
      field: 'flags.collapsed',
      value: true
    },
    {
      name: 'pinned state',
      change: (node: LGraphNode) => {
        node.flags.pinned = true
      },
      field: 'flags.pinned',
      value: true
    }
  ])(
    'mints the restored $name without replacing the node or its widgets',
    ({ change, field, value }) => {
      restoreThrough(() => change(source))

      expect(minted).toEqual([
        { op: 'set_node_field', node_id: String(source.id), field, value }
      ])
    }
  )

  it('deletes restored absent flags without changing unrelated flags or widgets', () => {
    source.flags.collapsed = true
    source.flags.pinned = true
    source.flags.keepAllLinksOnBypass = false

    restoreThrough(() => {
      delete source.flags.collapsed
      delete source.flags.pinned
    })

    expect(minted).toEqual([
      {
        op: 'set_node_field',
        node_id: String(source.id),
        field: 'flags.collapsed',
        value: null
      },
      {
        op: 'set_node_field',
        node_id: String(source.id),
        field: 'flags.pinned',
        value: null
      }
    ])
  })

  it('mints the full undo and redo scalar sequence on a surviving node', () => {
    restoreThrough(() => {
      source.mode = 4
    })
    restoreThrough(() => {
      source.mode = 0
    })
    restoreThrough(() => {
      source.mode = 4
    })

    expect(minted).toEqual([
      {
        op: 'set_node_field',
        node_id: String(source.id),
        field: 'mode',
        value: 4
      },
      {
        op: 'set_node_field',
        node_id: String(source.id),
        field: 'mode',
        value: 0
      },
      {
        op: 'set_node_field',
        node_id: String(source.id),
        field: 'mode',
        value: 4
      }
    ])
  })

  it('applies restored fields through the original document protocol without overwriting a concurrent widget edit', () => {
    source.disconnectOutput(0)
    const catalog = { types: { TestSource: { widget_order: ['image'] } } }
    const node = wireNodeSnapshot(source)!
    const doc = mint({ nodes: [node], links: [] }, catalog)
    onTestFinished(() => doc.destroy())
    applyOps(
      doc,
      mintWireOps(
        [
          {
            op: 'set_widget',
            node_id: source.id,
            widget: 'image',
            value: 'remote.png'
          }
        ],
        { actor: 'agent:owner:turn', baseVersion: 2 }
      ),
      catalog
    )

    restoreThrough(() => {
      source.title = 'Restored'
      source.mode = 4
      source.flags.pinned = true
    })
    const result = applyOps(
      doc,
      mintWireOps(minted, { actor: 'human:owner:tab', baseVersion: 3 }),
      catalog
    )

    expect(result.outcomes.map((entry) => entry.outcome)).toEqual([
      'applied',
      'applied',
      'applied'
    ])
    expect(project(doc, catalog).nodes[0]).toMatchObject({
      title: 'Restored',
      mode: 4,
      flags: { pinned: true },
      widgets_values: ['remote.png']
    })
  })

  it.for([
    {
      reason: 'an ordinary (non-undo) graph load',
      restoring: false,
      bound: true
    },
    { reason: 'no doc is bound', restoring: true, bound: false }
  ])('mints nothing across $reason', (scenario) => {
    restoring = scenario.restoring
    bound = scenario.bound

    restoreThrough(() => graph.remove(sink))

    expect(minted).toEqual([])
  })

  it('mints nothing when the load failed before configure', () => {
    notifyRestoreMintersBeforeGraphLoad()
    graph.remove(sink)
    notifyRestoreMintersGraphLoadError()
    notifyRestoreMintersAfterGraphConfigure()

    expect(minted).toEqual([])
  })

  it('mints nothing after detach', () => {
    minter.detach()

    restoreThrough(() => graph.remove(sink))

    expect(minted).toEqual([])
  })

  it('skips the whole diff, including real changes, when a present node cannot serialize', () => {
    restoreThrough(() => {
      source.widgets![0].value = 'b.png'
      sink.serialize = () => {
        throw new Error('custom node serialize failed')
      }
    })

    expect(minted).toEqual([])
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('could not serialize every present node'),
      [String(sink.id)]
    )
  })

  it('mints a standalone undone link as disconnect instead of leaving the document connected', () => {
    const linkId = sink.inputs[0].link

    restoreThrough(() => sink.disconnectInput(0))

    expect(minted).toEqual([
      { op: 'disconnect', link_id: linkId, to_node: sink.id, to_slot: 0 }
    ])
    expect(console.error).not.toHaveBeenCalled()
  })

  it('resolves an undone disconnect through the stable document input names', () => {
    const linkId = sink.inputs[0].link
    docInputs = ['other', 'image']
    restoreThrough(() => sink.disconnectInput(0))
    expect(minted).toEqual([
      { op: 'disconnect', link_id: linkId, to_node: sink.id, to_slot: 1 }
    ])
  })

  it('refuses the whole restore diff when a removed link input cannot be represented', () => {
    docInputs = ['other']
    restoreThrough(() => {
      source.widgets![0].value = 'changed.png'
      sink.disconnectInput(0)
    })
    expect(minted).toEqual([])
    expect(reportError).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        errorType: 'failure_restoring_agent_removed_link_input'
      })
    )
  })
})
