import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it, onTestFinished, vi } from 'vitest'
import { ref, shallowRef } from 'vue'

import type { ComfyWorkflow } from '@/platform/workflow/management/stores/comfyWorkflow'

import { createEmbeddedNativeOpener } from './domonEmbeddedNativeOpen'
import { runWithAutoQueueDisabled } from './domonEmbeddedBridge'

const docId = '01234567-89ab-4cde-8fab-0123456789ab'
const editorPath = `workflows/.native-agent/梦中的花园 (${docId}).json`

function fixture() {
  const userId = ref<string | null>('alice')
  const sessionScope = ref<string | null>('scope-a')
  const queueMode = ref('disabled')
  const uiAutoQueue = ref(false)
  const target = fromPartial<ComfyWorkflow>({
    path: editorPath,
    isTemporary: false
  })
  const previous = fromPartial<ComfyWorkflow>({
    path: 'workflows/Unsaved.json',
    isTemporary: true,
    isModified: true
  })
  const active = shallowRef(previous)
  const env: Parameters<typeof createEmbeddedNativeOpener>[0] = {
    userId: () => userId.value,
    sessionScope: () => sessionScope.value,
    panelEnabled: () => false,
    assertCanOpen: () =>
      runWithAutoQueueDisabled(
        queueMode.value,
        uiAutoQueue.value,
        () => undefined
      ),
    workflow: () => active.value,
    syncWorkflows: vi.fn(async () => undefined),
    getWorkflowByPath: () => target,
    readUserData: vi.fn(async () => new Response('{}')),
    openWorkflow: vi.fn(async (workflow, options) => {
      if (!options.isCurrent()) return false
      active.value = workflow
      return true
    }),
    bind: vi.fn(() => ({ ok: true as const }))
  }
  const opener = createEmbeddedNativeOpener(env)
  onTestFinished(() => opener.dispose())
  return {
    opener,
    env,
    target,
    previous,
    active,
    userId,
    sessionScope,
    queueMode,
    uiAutoQueue
  }
}

it('opens the owner-readable canonical file normally before binding its exact native document', async () => {
  const f = fixture()
  expect(await f.opener.open({ docId, editorPath })).toEqual({ ok: true })
  expect(f.env.syncWorkflows).toHaveBeenCalledWith('.native-agent')
  expect(f.env.readUserData).toHaveBeenCalledWith(editorPath)
  expect(f.env.openWorkflow).toHaveBeenCalledWith(f.target, {
    isCurrent: expect.any(Function)
  })
  expect(f.active.value).toBe(f.target)
  expect(f.previous.isModified).toBe(true)
  expect(f.env.bind).toHaveBeenCalledWith(docId)
})

it.for([
  { params: { docId: 'bad', editorPath }, code: 'invalid_doc_id' },
  {
    params: { docId, editorPath: `workflows/ordinary (${docId}).json` },
    code: 'invalid_native_path'
  },
  {
    params: {
      docId,
      editorPath: `workflows/.native-agent/child/name (${docId}).json`
    },
    code: 'invalid_native_path'
  },
  {
    params: {
      docId,
      editorPath:
        'workflows/.native-agent/Other (99999999-9999-4999-8999-999999999999).json'
    },
    code: 'invalid_native_path'
  }
])(
  'rejects invalid native identity before reading or opening: $code',
  async ({ params, code }) => {
    const f = fixture()
    expect(await f.opener.open(params)).toEqual({ ok: false, code })
    expect(f.env.readUserData).not.toHaveBeenCalled()
    expect(f.env.openWorkflow).not.toHaveBeenCalled()
    expect(f.env.bind).not.toHaveBeenCalled()
  }
)

it('does not open a cached workflow when current owner access is denied', async () => {
  const f = fixture()
  vi.mocked(f.env.readUserData).mockResolvedValue(
    new Response(null, { status: 404 })
  )
  expect(await f.opener.open({ docId, editorPath })).toEqual({
    ok: false,
    code: 'native_document_unavailable'
  })
  expect(f.active.value).toBe(f.previous)
  expect(f.env.openWorkflow).not.toHaveBeenCalled()
  expect(f.env.bind).not.toHaveBeenCalled()
})

it('rejects a superseded identity even if the same account returns before its read completes', async () => {
  const f = fixture()
  let finishRead: (value: Response) => void = () => {}
  vi.mocked(f.env.readUserData).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishRead = resolve
      })
  )
  const pending = f.opener.open({ docId, editorPath })
  await vi.waitFor(() => expect(f.env.readUserData).toHaveBeenCalledOnce())
  f.userId.value = 'bob'
  f.userId.value = 'alice'
  finishRead(new Response('{}'))
  expect(await pending).toEqual({ ok: false, code: 'identity_changed' })
  expect(f.env.openWorkflow).not.toHaveBeenCalled()
  expect(f.env.bind).not.toHaveBeenCalled()
})

it('does not bind when the normal editor open was cancelled or refused', async () => {
  const f = fixture()
  vi.mocked(f.env.openWorkflow).mockResolvedValue(false)
  expect(await f.opener.open({ docId, editorPath })).toEqual({
    ok: false,
    code: 'native_open_failed'
  })
  expect(f.active.value).toBe(f.previous)
  expect(f.env.bind).not.toHaveBeenCalled()
})

it('does not bind another active workflow after a successful but superseded editor open', async () => {
  const f = fixture()
  vi.mocked(f.env.openWorkflow).mockResolvedValue(true)
  expect(await f.opener.open({ docId, editorPath })).toEqual({
    ok: false,
    code: 'target_not_active'
  })
  expect(f.env.bind).not.toHaveBeenCalled()
})

it('checks the captured session throughout normal open and before binding', async () => {
  const f = fixture()
  vi.mocked(f.env.openWorkflow).mockImplementation(async (_target, options) => {
    expect(options.isCurrent()).toBe(true)
    f.sessionScope.value = 'scope-replaced'
    expect(options.isCurrent()).toBe(false)
    return true
  })
  expect(await f.opener.open({ docId, editorPath })).toEqual({
    ok: false,
    code: 'identity_changed'
  })
  expect(f.env.bind).not.toHaveBeenCalled()
})

it.for([
  { mode: 'change', uiEnabled: false },
  { mode: 'disabled', uiEnabled: true }
])(
  'refuses native opening while automatic queue is enabled: $mode/$uiEnabled',
  async ({ mode, uiEnabled }) => {
    const f = fixture()
    f.queueMode.value = mode
    f.uiAutoQueue.value = uiEnabled
    await expect(f.opener.open({ docId, editorPath })).rejects.toMatchObject({
      code: 'auto_queue_active'
    })
    expect(f.env.syncWorkflows).not.toHaveBeenCalled()
    expect(f.env.openWorkflow).not.toHaveBeenCalled()
    expect(f.env.bind).not.toHaveBeenCalled()
    expect(f.queueMode.value).toBe(mode)
    expect(f.uiAutoQueue.value).toBe(uiEnabled)
  }
)

it('rechecks automatic queue after asynchronous file resolution before normal opening', async () => {
  const f = fixture()
  vi.mocked(f.env.syncWorkflows).mockImplementation(async () => {
    f.queueMode.value = 'change'
  })
  await expect(f.opener.open({ docId, editorPath })).rejects.toMatchObject({
    code: 'auto_queue_active'
  })
  expect(f.env.openWorkflow).not.toHaveBeenCalled()
  expect(f.env.bind).not.toHaveBeenCalled()
  expect(f.queueMode.value).toBe('change')
})

it('refuses graph activation when automatic queue changes during the normal remote load', async () => {
  const f = fixture()
  vi.mocked(f.env.openWorkflow).mockImplementation(async (target, options) => {
    await Promise.resolve()
    f.queueMode.value = 'change'
    if (!options.isCurrent()) return false
    f.active.value = target
    return true
  })
  await expect(f.opener.open({ docId, editorPath })).rejects.toMatchObject({
    code: 'auto_queue_active'
  })
  expect(f.active.value).toBe(f.previous)
  expect(f.previous.isModified).toBe(true)
  expect(f.env.bind).not.toHaveBeenCalled()
  expect(f.queueMode.value).toBe('change')
})
