import {
  linksMap,
  nodesMap,
  OPAQUE_WIDGETS_KEY
} from '@comfyorg/comfy-multi-player'
import { describe, expect, it, onTestFinished } from 'vitest'
import * as Y from 'yjs'

import { DocChangeCollector } from './docChangeCollector'

function docNode(fields: Record<string, unknown> = {}): Y.Map<unknown> {
  return new Y.Map<unknown>(
    Object.entries({ type: 'Test', pos: [0, 0], ...fields })
  )
}

function setup() {
  const doc = new Y.Doc()
  const collector = new DocChangeCollector(doc)
  onTestFinished(() => {
    collector.destroy()
    doc.destroy()
  })
  doc.transact(() => {
    nodesMap(doc).set('1', docNode({ widgets: new Y.Map([['seed', 1]]) }))
    nodesMap(doc).set('2', docNode())
  })
  collector.take()
  return { doc, collector }
}

function interiorFixture() {
  const { doc, collector } = setup()
  const direct = new Y.Map<unknown>([['value', 1]])
  const nested = new Y.Map<unknown>([['value', 2]])
  const nestedNode = docNode({ widgets: nested })
  const inner = new Y.Map<unknown>([['nodes', new Y.Map([['1', nestedNode]])]])
  doc.getMap('definitions').set(
    'outer',
    new Y.Map<unknown>([
      ['nodes', new Y.Map([['1', docNode({ widgets: direct })]])],
      ['definitions', new Y.Map([['subgraphs', new Y.Map([['inner', inner]])]])]
    ])
  )
  collector.take()
  return { doc, collector, direct, nested, nestedNode, inner }
}

describe('DocChangeCollector', () => {
  it.for(['inputs', 'outputs', 'type'])(
    'records interior node %s changes without touching equal-ID root nodes',
    (field) => {
      const { collector, nestedNode } = interiorFixture()
      nestedNode.set(field, [])
      const changes = collector.take()
      expect(changes.interiorTopology).toEqual(new Set(['inner']))
      expect(changes.nodes.size + changes.links.size).toBe(0)
      expect(changes.interiorWidgets).toBeUndefined()
    }
  )

  it.for(['nodes', 'links', 'inputs', 'outputs'])(
    'collects definition %s replacement and nested mutations',
    (field) => {
      const { collector, inner } = interiorFixture()
      const entries = new Y.Map<unknown>()
      inner.set(field, entries)
      expect(collector.take().interiorTopology).toEqual(new Set(['inner']))
      entries.set('1', new Y.Map([['link', 2]]))
      expect(collector.take().interiorTopology).toEqual(new Set(['inner']))
      entries.delete('1')
      expect(collector.take().interiorTopology).toEqual(new Set(['inner']))
    }
  )

  it('tracks deep port edits and isolates snapshots through teardown', () => {
    const { collector, nestedNode, doc } = interiorFixture()
    const ports = new Y.Array<unknown>()
    const port = new Y.Map<unknown>([['name', 'image']])
    ports.push([port])
    nestedNode.set('inputs', ports)
    collector.discard()
    port.set('name', 'text')
    const first = collector.peek()
    doc.getMap('definitions').delete('outer')
    expect(first.interiorTopology).toEqual(new Set(['inner']))
    expect(collector.take().interiorTopology).toEqual(
      new Set(['inner', 'outer'])
    )
    expect(collector.take().interiorTopology).toBeUndefined()
    collector.destroy()
    doc.getMap('definitions').set('outer', new Y.Map())
    doc.getMap('definitions').delete('outer')
    expect(collector.peek().interiorTopology).toBeUndefined()
  })

  it('distinguishes initial registration from replacement of an existing definition', () => {
    const { collector, doc } = setup()
    doc.getMap('definitions').set('new', new Y.Map())
    const initial = collector.take()
    expect(initial.interiorTopology).toBeUndefined()
    expect(initial.registeredDefinitions).toEqual(new Set(['new']))
    expect(collector.peek().registeredDefinitions).toBeUndefined()
    doc.getMap('definitions').set('new', new Y.Map())
    expect(collector.take().interiorTopology).toEqual(new Set(['new']))
  })

  it('scopes nested definition replacement to its own identity', () => {
    const { collector, inner } = interiorFixture()
    const definitions = new Y.Map<unknown>()
    inner.set('definitions', new Y.Map([['subgraphs', definitions]]))
    definitions.set('leaf', new Y.Map())
    collector.discard()
    definitions.set('leaf', new Y.Map())
    expect(collector.take().interiorTopology).toEqual(new Set(['leaf']))
  })

  it('does not classify interior layout or widget changes as topology', () => {
    const { collector, nestedNode, nested } = interiorFixture()
    nestedNode.set('pos', [100, 200])
    nested.set('value', 3)
    expect(collector.take().interiorTopology).toBeUndefined()
  })

  it.for([
    { scope: 'direct' as const, definitionId: 'outer' },
    { scope: 'nested' as const, definitionId: 'inner' }
  ])(
    'keeps $scope interior widget changes separate from equal-ID root nodes',
    ({ scope, definitionId }) => {
      const fixture = interiorFixture()
      fixture[scope].set('value', 73)
      const first = fixture.collector.peek()
      fixture[scope].set('extra', 4)
      expect(first.interiorWidgets).toEqual(
        new Map([[definitionId, new Map([['1', new Set(['value'])]])]])
      )
      expect(first.interiorTopology).toBeUndefined()
      const changes = fixture.collector.take()
      expect(changes.interiorWidgets).toEqual(
        new Map([[definitionId, new Map([['1', new Set(['value', 'extra'])]])]])
      )
      expect(
        changes.widgets.size + changes.nodes.size + changes.resyncNodes.size
      ).toBe(0)
      expect(fixture.collector.take().interiorWidgets).toBeUndefined()
    }
  )

  it('coalesces interior storage replacement and stops collecting it after teardown', () => {
    const { collector, nestedNode } = interiorFixture()
    nestedNode.set('widgets', new Y.Map([['value', 77]]))
    expect(collector.take().interiorWidgets).toEqual(
      new Map([['inner', new Map([['1', 'all']])]])
    )
    collector.destroy()
    nestedNode.set('widgets', new Y.Map([['value', 99]]))
    expect(collector.take().interiorWidgets).toBeUndefined()
  })

  it('records node adds, updates and deletes by document key', () => {
    const { doc, collector } = setup()

    doc.transact(() => {
      nodesMap(doc).set('3', docNode())
      nodesMap(doc).set('2', docNode({ type: 'Other' }))
      nodesMap(doc).delete('1')
    })

    expect([...collector.take().nodes]).toEqual([
      ['3', 'add'],
      ['2', 'update'],
      ['1', 'delete']
    ])
  })

  it('keeps only the effective action for a node id touched repeatedly before a take', () => {
    const { doc, collector } = setup()

    doc.transact(() => {
      nodesMap(doc).set('3', docNode())
      nodesMap(doc).set('3', docNode({ type: 'Other' }))
      nodesMap(doc).delete('3')
      nodesMap(doc).set('2', docNode({ type: 'Other' }))
      nodesMap(doc).delete('2')
    })
    doc.transact(() => nodesMap(doc).set('4', docNode()))
    doc.transact(() => nodesMap(doc).delete('4'))

    expect([...collector.take().nodes]).toEqual([
      ['2', 'delete'],
      ['4', 'delete']
    ])
  })

  it('records named widget edits per node and a replaced storage as all', () => {
    const { doc, collector } = setup()

    doc.transact(() => {
      const widgets = nodesMap(doc).get('1')?.get('widgets')
      if (!(widgets instanceof Y.Map)) throw new Error('named storage')
      widgets.set('steps', 20)
      widgets.set('seed', 2)
    })
    expect(collector.take().widgets).toEqual(
      new Map([['1', new Set(['steps', 'seed'])]])
    )

    doc.transact(() => {
      nodesMap(doc).get('2')?.set(OPAQUE_WIDGETS_KEY, [1, 2])
    })
    expect(collector.take().widgets).toEqual(new Map([['2', 'all']]))

    doc.transact(() => {
      const opaque = new Y.Array<unknown>()
      nodesMap(doc).get('2')?.set(OPAQUE_WIDGETS_KEY, opaque)
    })
    collector.take()
    doc.transact(() => {
      const opaque = nodesMap(doc).get('2')?.get(OPAQUE_WIDGETS_KEY)
      if (!(opaque instanceof Y.Array)) throw new Error('opaque storage')
      opaque.push([7])
    })
    expect(collector.take().widgets).toEqual(new Map([['2', 'all']]))
  })

  it('flags a node for field resync only when a synced field changes', () => {
    const { doc, collector } = setup()

    doc.transact(() => {
      nodesMap(doc).get('1')?.set('pos', [10, 10])
      nodesMap(doc).get('2')?.set('title', 'Renamed')
    })

    const changes = collector.take()
    expect(changes.resyncNodes).toEqual(new Set(['2']))
    expect(changes.nodes.size).toBe(0)
  })

  it('flags a node for field resync when one flag register changes inside its nested flags map', () => {
    const { doc, collector } = setup()
    doc.transact(() => {
      nodesMap(doc)
        .get('1')
        ?.set('flags', new Y.Map([['pinned', true]]))
    })
    collector.take()

    doc.transact(() => {
      const flags = nodesMap(doc).get('1')?.get('flags')
      if (!(flags instanceof Y.Map)) throw new Error('nested flags')
      flags.set('collapsed', true)
    })

    const changes = collector.take()
    expect(changes.resyncNodes).toEqual(new Set(['1']))
    expect(changes.widgets.size).toBe(0)
  })

  it('records link keys, clears on take, and stops observing after destroy', () => {
    const { doc, collector } = setup()

    doc.transact(() => {
      linksMap(doc).set('9', [9, 1, 0, 2, 0, 'IMAGE'])
    })
    expect(collector.take().links).toEqual(new Set(['9']))
    expect(collector.take().links).toEqual(new Set())

    collector.destroy()
    doc.transact(() => {
      linksMap(doc).delete('9')
      nodesMap(doc).set('4', docNode())
    })
    const after = collector.take()
    expect(after.links.size + after.nodes.size).toBe(0)
  })
})
