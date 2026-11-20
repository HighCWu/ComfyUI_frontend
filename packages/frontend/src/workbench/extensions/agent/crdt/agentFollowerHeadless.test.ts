import { fromPartial } from '@total-typescript/shoehorn'
import { mint } from '@comfyorg/comfy-multi-player'
import type { Op, WorkflowJSON } from '@comfyorg/comfy-multi-player'
import { assert, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { computed, effectScope, nextTick, ref, shallowRef, toRef } from 'vue'
import type { Ref } from 'vue'
import * as Y from 'yjs'

import { LGraph, LGraphNode, LiteGraph } from '@/lib/litegraph/src/litegraph'
import { withGraphIntentSource } from '@/lib/litegraph/src/graphIntents'
import type { ISerialisedGraph } from '@/lib/litegraph/src/types/serialisation'
import { isRootGraphDocBound } from '@/lib/litegraph/src/docBoundGraphs'
import type { ComfyWorkflow } from '@/platform/workflow/management/stores/comfyWorkflow'
import { zComfyWorkflow } from '@/platform/workflow/validation/schemas/workflowSchema'
import { api } from '@/scripts/api'
import { usePrepaidSessionStore } from '@/stores/prepaidSessionStore'
import { remoteConfigState } from '@/platform/remoteConfig/remoteConfig'
import { useAgentPanelStore } from '../stores/agent/agentPanelStore'
import { useEmbeddedFollowerSession } from '@/extensions/core/domonEmbeddedSession'

import { createAgentFollowerHeadless } from './agentFollowerHeadless'
import { bindAgentCrdtTransport } from './agentCrdtTransport'
import { encodeBase64 } from './docFrameClient'
import { attachDocOpMinter } from './docOpMinter'
import { useAgentCrdtFollower } from './useAgentCrdtFollower'

const DOC = '12345678-1234-4234-8234-123456789abc'

vi.mock(import('firebase/auth'))

beforeEach(() => {
  vi.stubEnv('VITE_RUN_BILLING_MODE', 'prepaid')
})

function fixture(
  sessionSource?: ReturnType<typeof useEmbeddedFollowerSession>,
  beforeHeadless?: (
    graph: LGraph,
    userId: Ref<string | null>,
    panel: Ref<boolean>
  ) => void
) {
  usePrepaidSessionStore().initialized = true
  LiteGraph.registerNodeType('HeadlessNode', HeadlessNode)
  const graph = new LGraph()
  const restoring = ref(false)
  const workflow = shallowRef<ComfyWorkflow | null>(
    fromPartial<ComfyWorkflow>({
      path: `workflows/.native-agent/Example (${DOC}).json`,
      isTemporary: false,
      get activeState() {
        return zComfyWorkflow.parse(graph.serialize())
      },
      changeTracker: {
        get _restoringState() {
          return restoring.value
        },
        prepareForSave() {}
      }
    })
  )
  const userId = ref<string | null>('alice')
  const session = ref<string | null>('grant-a')
  const panelStore = useAgentPanelStore()
  const panel = toRef(panelStore, 'enabled')
  panel.value = false
  const sent: string[] = []
  const events = new EventTarget()
  const previousSocket = api.socket
  api.socket = fromPartial<WebSocket>({
    readyState: WebSocket.OPEN,
    send(data) {
      if (typeof data === 'string') sent.push(data)
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events)
  })
  beforeHeadless?.(graph, userId, panel)
  const follower = createAgentFollowerHeadless({
    userId: sessionSource?.userId ?? (() => userId.value),
    sessionScope: sessionSource?.sessionScope ?? (() => session.value),
    workflow: () => workflow.value,
    panelEnabled: () => panel.value,
    graph: () => graph,
    applier: {}
  })
  onTestFinished(() => {
    follower.dispose()
    api.socket = previousSocket
  })
  return {
    follower,
    workflow,
    userId,
    session,
    panel,
    sent,
    events,
    graph,
    restoring
  }
}

class HeadlessNode extends LGraphNode {
  constructor() {
    super('Headless node')
  }
}

function node() {
  const created = LiteGraph.createNode('HeadlessNode')
  assert.exists(created)
  return created
}

function workflowJson({ nodes, ...rest }: ISerialisedGraph): WorkflowJSON {
  return {
    ...rest,
    nodes: nodes.map(({ flags, ...item }) => ({ ...item, flags: { ...flags } }))
  }
}

function catchUp(graph: LGraph) {
  const host = mint(workflowJson(graph.serialize()), {
    types: { HeadlessNode: { widget_order: [] } }
  })
  onTestFinished(() => host.destroy())
  EventTarget.prototype.dispatchEvent.call(
    api,
    new CustomEvent('doc_subscribed', {
      detail: { v: 1, workflow_id: DOC, ok: true, seq: 1 }
    })
  )
  EventTarget.prototype.dispatchEvent.call(
    api,
    new CustomEvent('doc_update', {
      detail: {
        v: 1,
        workflow_id: DOC,
        seq: 1,
        update_b64: encodeBase64(Y.encodeStateAsUpdate(host)),
        actor: 'agent:comfy:host'
      }
    })
  )
}

function operations(sent: string[]): Op[] {
  return sent
    .map((raw) => JSON.parse(raw) as { type: string; data: { ops: Op[] } })
    .filter((frame) => frame.type === 'doc_ops')
    .flatMap((frame) => frame.data.ops)
}

it('binds only the active canonical native workflow and uses the Comfy socket despite a global panel transport', async () => {
  const f = fixture()
  const nativeSend = vi.fn(() => true)
  const release = bindAgentCrdtTransport({
    send: nativeSend,
    addEventListener() {},
    removeEventListener() {}
  })
  onTestFinished(release)
  expect(f.follower.bind(DOC)).toEqual({ ok: true })
  await nextTick()
  expect(
    f.sent.some((frame) => JSON.parse(frame).type === 'doc_subscribe')
  ).toBe(true)
  expect(nativeSend).not.toHaveBeenCalled()
  EventTarget.prototype.dispatchEvent.call(
    api,
    new CustomEvent('doc_subscribed', {
      detail: { v: 1, workflow_id: DOC, ok: true, seq: 1 }
    })
  )
  expect(f.follower.status()).toMatchObject({ started: true, docId: DOC })
  expect(isRootGraphDocBound(f.graph.id)).toBe(true)
  f.follower.unbind()
  expect(f.follower.status()).toEqual({
    started: false,
    docId: null,
    crdt: null
  })
  expect(isRootGraphDocBound(f.graph.id)).toBe(false)
})

type Fixture = ReturnType<typeof fixture>

it.for([
  {
    kind: 'identity',
    code: 'identity_unresolved',
    configure: (f: Fixture) => {
      f.userId.value = null
    },
    docId: DOC
  },
  {
    kind: 'panel',
    code: 'panel_owner_active',
    configure: (f: Fixture) => {
      f.panel.value = true
    },
    docId: DOC
  },
  {
    kind: 'alias',
    code: 'target_unverified',
    configure: (f: Fixture) => {
      f.workflow.value = fromPartial<ComfyWorkflow>({
        path: 'workflows/renamed.json',
        isTemporary: false
      })
    },
    docId: DOC
  },
  {
    kind: 'different',
    code: 'target_not_active',
    configure: () => {},
    docId: '87654321-1234-4234-8234-123456789abc'
  }
] as const)(
  'refuses $kind without starting a follower',
  ({ configure, code, docId }) => {
    const f = fixture()
    configure(f)
    expect(f.follower.bind(docId)).toEqual({ ok: false, code })
    expect(f.follower.status().started).toBe(false)
    expect(f.sent).toEqual([])
  }
)

it.for([
  {
    kind: 'identity',
    replace: (f: Fixture) => {
      f.userId.value = 'bob'
    }
  },
  {
    kind: 'session',
    replace: (f: Fixture) => {
      f.session.value = 'grant-b'
    }
  },
  {
    kind: 'panel',
    replace: (f: Fixture) => {
      f.panel.value = true
    }
  },
  {
    kind: 'workflow',
    replace: (f: Fixture) => {
      f.workflow.value = null
    }
  }
])('stops synchronously on $kind replacement', async ({ replace }) => {
  const f = fixture()
  expect(f.follower.bind(DOC)).toEqual({ ok: true })
  await nextTick()
  replace(f)
  expect(f.follower.status()).toEqual({
    started: false,
    docId: null,
    crdt: null
  })
})

it('stops on a policy close and rejects new binds after disposal', async () => {
  const f = fixture()
  expect(f.follower.bind(DOC)).toEqual({ ok: true })
  await nextTick()
  f.events.dispatchEvent(new CloseEvent('close', { code: 1008 }))
  expect(f.follower.status().started).toBe(false)
  f.follower.dispose()
  expect(f.follower.bind(DOC)).toEqual({ ok: false, code: 'disposed' })
})

it('uses the receiver session rail backed by real prepaid reads and stops on grant replacement', async () => {
  vi.stubEnv('VITE_RUN_BILLING_MODE', 'prepaid')
  const user = {
    id: 'alice',
    name: 'Alice',
    email: 'alice@example.test',
    emailVerified: true
  }
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      Response.json({ user, socket_scope: 'a'.repeat(64) })
    )
    .mockResolvedValueOnce(
      Response.json({ user, socket_scope: 'b'.repeat(64) })
    )
  const store = usePrepaidSessionStore()
  await store.initialize()
  remoteConfigState.value = 'anonymous'
  const source = useEmbeddedFollowerSession()
  const f = fixture(source)
  expect(source.sessionScope()).toBe('a'.repeat(64))
  expect(f.follower.bind(DOC)).toEqual({ ok: true })
  await nextTick()
  await store.refresh()
  expect(source.userId()).toBe('alice')
  expect(source.sessionScope()).toBe('b'.repeat(64))
  expect(f.follower.status().started).toBe(false)
})

it('sends a semantic add from the real graph-intent minter through the headless follower', async () => {
  const f = fixture()
  expect(f.follower.bind(DOC)).toEqual({ ok: true })
  await nextTick()
  catchUp(f.graph)
  const added = node()
  f.graph.add(added)
  await Promise.resolve()
  await Promise.resolve()
  expect(operations(f.sent)).toEqual([
    expect.objectContaining({
      op: 'add_node',
      node_id: String(added.id),
      class_type: 'HeadlessNode'
    })
  ])
})

it('mints an undo deletion through the restore lifecycle instead of ordinary load intents', async () => {
  const f = fixture()
  const removed = node()
  f.graph.add(removed)
  expect(f.follower.bind(DOC)).toEqual({ ok: true })
  await nextTick()
  catchUp(f.graph)
  f.restoring.value = true
  f.follower.beforeLoadGraph()
  withGraphIntentSource('load', () => f.graph.remove(removed))
  f.follower.afterConfigureGraph()
  await Promise.resolve()
  await Promise.resolve()
  expect(operations(f.sent)).toEqual([
    expect.objectContaining({ op: 'delete_node', node_id: String(removed.id) })
  ])
})

it('drops a queued headless edit when the original panel follower takes ownership synchronously', async () => {
  const scope = effectScope()
  const f = fixture(undefined, (graph, userId, panel) => {
    const panelFollower = scope.run(() =>
      useAgentCrdtFollower(
        ref(DOC),
        () => userId.value,
        computed(() => panel.value),
        () => graph
      )
    )
    assert.exists(panelFollower)
    const panelMinter = attachDocOpMinter({
      isEnabled: () => panel.value,
      isDocBound: panelFollower.subscriptionSent,
      enqueue: panelFollower.enqueueHumanOperations,
      getGraph: () => graph,
      boundRootGraphId: () => null,
      docInputNames: panelFollower.docInputNames,
      docPromotedWidgets: panelFollower.docPromotedWidgets,
      mayWritePromotedHost: panelFollower.mayWritePromotedHost,
      onWidgetWriteRefused: panelFollower.notifyWidgetWriteRefused
    })
    onTestFinished(() => {
      panelMinter.detach()
      scope.stop()
    })
  })
  expect(f.follower.bind(DOC)).toEqual({ ok: true })
  await nextTick()
  catchUp(f.graph)
  f.graph.add(node())
  f.panel.value = true
  expect(f.follower.status().started).toBe(false)
  await nextTick()
  await Promise.resolve()
  expect(operations(f.sent)).toEqual([])
  catchUp(f.graph)
  const added = node()
  f.graph.add(added)
  await Promise.resolve()
  await Promise.resolve()
  expect(operations(f.sent)).toEqual([
    expect.objectContaining({
      op: 'add_node',
      node_id: String(added.id),
      class_type: 'HeadlessNode'
    })
  ])
})
