import { expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import type { GraphOperation } from './graphOperations'
import {
  bindHumanNodeIncarnations,
  createHumanNodeIncarnationBinder
} from './humanNodeIncarnation'

it('keeps the restored lifetime for edits queued before acknowledgement and retires it when presence advances', () => {
  const doc = new Y.Doc()
  try {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '019fe0a9-9be1-7ee0-a530-2994d9a8aac1'
    )
    doc
      .getMap('__stamps')
      .set(JSON.stringify(['node', '1']), [4, 'agent:owner:turn', 'deleted'])
    const bind = createHumanNodeIncarnationBinder()
    bind(
      [
        {
          op: 'add_node',
          node_id: 1,
          class_type: 'Example',
          node: { id: 1, type: 'Example' },
          pos: [0, 0]
        }
      ],
      doc
    )
    const edit: GraphOperation = {
      op: 'set_widget',
      node_id: 1,
      widget: 'steps',
      value: 25
    }
    expect(bind([edit], doc)).toEqual([
      { ...edit, node_incarnation: '019fe0a9-9be1-7ee0-a530-2994d9a8aac1' }
    ])
    doc
      .getMap('nodes')
      .set('1', new Y.Map([['__incarnation', 'another-tab-restoration']]))
    doc
      .getMap('__stamps')
      .set(JSON.stringify(['node', '1']), [9, 'human:owner:other', 'restored'])
    expect(bind([edit], doc)).toEqual([
      { ...edit, node_incarnation: 'another-tab-restoration' }
    ])
    doc.getMap('nodes').delete('1')
    doc
      .getMap('__stamps')
      .set(JSON.stringify(['node', '1']), [
        10,
        'human:owner:other',
        'deleted-again'
      ])
    expect(bind([edit], doc)).toEqual([edit])
  } finally {
    doc.destroy()
  }
})

it('gives an undone deletion a fresh lifetime and binds same-batch edits to it', () => {
  const doc = new Y.Doc()
  try {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '019fe0a9-9be1-7ee0-a530-2994d9a8aac1'
    )
    doc
      .getMap('__stamps')
      .set(JSON.stringify(['node', '1']), [4, 'agent:owner:turn', 'deleted'])
    const operations: GraphOperation[] = [
      {
        op: 'add_node',
        node_id: 1,
        class_type: 'Example',
        node: { id: 1, type: 'Example' },
        pos: [40, 80]
      },
      { op: 'set_widget', node_id: 1, widget: 'steps', value: 20 }
    ]
    expect(bindHumanNodeIncarnations(operations, doc)).toEqual([
      {
        ...operations[0],
        node_incarnation: '019fe0a9-9be1-7ee0-a530-2994d9a8aac1'
      },
      {
        ...operations[1],
        node_incarnation: '019fe0a9-9be1-7ee0-a530-2994d9a8aac1'
      }
    ])
    expect(operations[0]).not.toHaveProperty('node_incarnation')
  } finally {
    doc.destroy()
  }
})

it('preserves new-node and interior creation and an explicit restored lifetime', () => {
  const doc = new Y.Doc()
  try {
    doc
      .getMap('__stamps')
      .set(JSON.stringify(['node', '1']), [4, 'human:owner:tab', 'deleted'])
    const operations: GraphOperation[] = [
      {
        op: 'add_node',
        node_id: 2,
        class_type: 'Example',
        node: { id: 2, type: 'Example' },
        pos: [0, 0]
      },
      {
        op: 'add_node',
        node_id: 1,
        class_type: 'Example',
        node: { id: 1, type: 'Example' },
        pos: [0, 0],
        path: ['inner']
      },
      {
        op: 'add_node',
        node_id: 1,
        class_type: 'Example',
        node: { id: 1, type: 'Example' },
        pos: [0, 0],
        node_incarnation: 'restored'
      },
      { op: 'set_node_field', node_id: 1, field: 'title', value: 'Restored' }
    ]
    expect(bindHumanNodeIncarnations(operations, doc)).toEqual([
      operations[0],
      operations[1],
      operations[2],
      { ...operations[3], node_incarnation: 'restored' }
    ])
  } finally {
    doc.destroy()
  }
})

it.for<GraphOperation>([
  { op: 'set_widget', node_id: 1, widget: 'steps', value: 20 },
  { op: 'set_node_field', node_id: 1, field: 'title', value: 'Sampler' }
])('captures the lifetime of a $op before queueing', (operation) => {
  const doc = new Y.Doc()
  try {
    const node = new Y.Map<unknown>()
    node.set('__incarnation', 'current-life')
    doc.getMap('nodes').set('1', node)
    const result = bindHumanNodeIncarnations([operation], doc)
    node.set('__incarnation', 'replacement-life')
    expect(result).toEqual([{ ...operation, node_incarnation: 'current-life' }])
    expect(operation).not.toHaveProperty('node_incarnation')
  } finally {
    doc.destroy()
  }
})

it('preserves explicit lifetimes and leaves legacy, missing and interior targets unchanged', () => {
  const doc = new Y.Doc()
  try {
    doc.getMap('nodes').set('1', new Y.Map([['__incarnation', 'current-life']]))
    doc.getMap('nodes').set('2', new Y.Map([['__incarnation', '0']]))
    const operations: GraphOperation[] = [
      {
        op: 'set_widget',
        node_id: 1,
        widget: 'steps',
        value: 20,
        node_incarnation: 'old-life'
      },
      { op: 'set_widget', node_id: 2, widget: 'steps', value: 20 },
      { op: 'set_widget', node_id: 3, widget: 'steps', value: 20 },
      {
        op: 'set_widget',
        node_id: 1,
        widget: 'steps',
        value: 20,
        path: ['subgraph', '1'],
        inner_widget: 'steps'
      }
    ]
    expect(bindHumanNodeIncarnations(operations, doc)).toEqual(operations)
  } finally {
    doc.destroy()
  }
})
