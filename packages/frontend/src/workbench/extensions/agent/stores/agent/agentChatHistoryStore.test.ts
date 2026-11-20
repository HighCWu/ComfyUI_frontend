import { beforeEach, describe, expect, it, vi } from 'vitest'

import { StorageKeys } from '@/platform/workflow/persistence/base/storageKeys'
import { api } from '@/scripts/api'
import { reportError } from '@/platform/telemetry/reportError'

import type { ChatSession } from './agentChatHistoryStore'
import {
  groupSessionsByRecency,
  useAgentChatHistoryStore
} from './agentChatHistoryStore'

vi.mock(import('@/platform/distribution/types'), () => ({ isCloud: true }))
vi.mock(import('@/scripts/api'))
vi.mock(import('@/platform/telemetry/reportError'))

const NOW = new Date(2026, 2, 15, 12, 0, 0).getTime()
const DAY = 86_400_000

const session = (
  id: string,
  updatedAt: number,
  titleSource: ChatSession['titleSource'] = 'server'
): ChatSession => ({
  id,
  title: id,
  updatedAt,
  titleSource
})

const failedRenameResponses = [
  { name: 'HTTP refusal', response: () => new Response(null, { status: 403 }) },
  {
    name: 'wrong identity',
    response: () => Response.json({ id: 'agt_other', title: 'Wrong' })
  },
  {
    name: 'invalid title',
    response: () => Response.json({ id: 'agt_a', title: '' })
  },
  { name: 'malformed JSON', response: () => new Response('{') }
]

describe('groupSessionsByRecency', () => {
  it('buckets by recency, newest first, with the active session as Current', () => {
    const sessions = [
      session('now', NOW - 1_000),
      session('active', NOW - 5 * DAY),
      session('earlyToday', NOW - 6 * 3_600_000),
      session('yesterday', NOW - DAY),
      session('lastWeek', NOW - 4 * DAY)
    ]
    const groups = groupSessionsByRecency(sessions, 'active', NOW)

    expect(groups.current.map((s) => s.id)).toEqual(['active'])
    expect(groups.today.map((s) => s.id)).toEqual(['now', 'earlyToday'])
    expect(groups.yesterday.map((s) => s.id)).toEqual(['yesterday'])
    expect(groups.earlier.map((s) => s.id)).toEqual(['lastWeek'])
  })

  it('places everything in earlier when nothing is recent and none is active', () => {
    const groups = groupSessionsByRecency(
      [session('old', NOW - 30 * DAY)],
      null,
      NOW
    )
    expect(groups.current).toHaveLength(0)
    expect(groups.earlier.map((s) => s.id)).toEqual(['old'])
  })

  it('buckets the prior evening as yesterday across a spring-forward midnight', () => {
    const now = new Date(2026, 2, 8, 2, 30).getTime()
    const priorEvening = new Date(2026, 2, 7, 23, 30).getTime()
    const groups = groupSessionsByRecency(
      [session('priorEvening', priorEvening)],
      null,
      now
    )

    expect(groups.yesterday.map((s) => s.id)).toEqual(['priorEvening'])
    expect(groups.earlier).toHaveLength(0)
  })
})

describe('useAgentChatHistoryStore', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('overlays a rename onto the grouped list and titleFor', async () => {
    const store = useAgentChatHistoryStore()
    store.replaceAll([session('a', NOW - 1_000)])
    store.setActive('a')

    await store.rename('a', '  Duck pipeline  ')

    expect(store.titleFor('a')).toBe('Duck pipeline')
    expect(store.grouped.current[0]).toMatchObject({
      id: 'a',
      title: 'Duck pipeline'
    })
  })

  it('ignores a whitespace-only rename', async () => {
    const store = useAgentChatHistoryStore()
    await store.rename('a', '   ')

    expect(store.titleFor('a')).toBeUndefined()
  })

  it('drops the rename override with the session', async () => {
    const store = useAgentChatHistoryStore()
    store.replaceAll([session('a', 1)])
    await store.rename('a', 'kept?')

    await store.deleteThread('a')

    expect(store.titleFor('a')).toBeUndefined()
  })

  it('uses server titles rather than old local overlays in native mode', () => {
    vi.stubEnv('VITE_AGENT_BACKEND_MODE', 'official')
    localStorage.setItem(
      StorageKeys.agentChatTitles('personal'),
      JSON.stringify({ agt_a: 'Old browser title' })
    )
    const store = useAgentChatHistoryStore()
    store.replaceAll([{ ...session('agt_a', NOW), title: 'Server title' }])
    store.setActive('agt_a')

    expect(store.titleFor('agt_a')).toBe('Server title')
    expect(store.grouped.current[0]?.title).toBe('Server title')
  })

  it('waits for server confirmation and rejects overlapping renames', async () => {
    vi.stubEnv('VITE_AGENT_BACKEND_MODE', 'official')
    const reply = Promise.withResolvers<Response>()
    vi.mocked(api.fetchApi).mockReturnValueOnce(reply.promise)
    const store = useAgentChatHistoryStore()
    store.replaceAll([session('agt_a', NOW)])
    const saving = store.rename('agt_a', '  Saved title  ')

    expect(store.titleFor('agt_a')).toBe('agt_a')
    expect(await store.rename('agt_a', 'Overlapping title')).toBe(false)
    expect(api.fetchApi).toHaveBeenCalledOnce()
    reply.resolve(Response.json({ id: 'agt_a', title: 'Saved title' }))

    expect(await saving).toBe(true)
    expect(store.titleFor('agt_a')).toBe('Saved title')
    expect(api.fetchApi).toHaveBeenCalledWith(
      '/agent/threads/agt_a',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ title: 'Saved title' })
      })
    )
    store.replaceAll([
      { ...session('agt_a', NOW), title: 'Other device title' }
    ])
    expect(store.titleFor('agt_a')).toBe('Other device title')
  })

  it.for(failedRenameResponses)(
    'keeps the previous title after $name',
    async ({ response }) => {
      vi.stubEnv('VITE_AGENT_BACKEND_MODE', 'official')
      vi.mocked(api.fetchApi).mockResolvedValueOnce(response())
      const store = useAgentChatHistoryStore()
      store.replaceAll([session('agt_a', NOW)])

      expect(await store.rename('agt_a', 'Unsaved title')).toBe(false)
      expect(store.titleFor('agt_a')).toBe('agt_a')
      expect(reportError).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ errorType: 'agent_thread_rename_failed' })
      )
    }
  )

  it('does not apply an acknowledgement after store disposal', async () => {
    vi.stubEnv('VITE_AGENT_BACKEND_MODE', 'official')
    const reply = Promise.withResolvers<Response>()
    vi.mocked(api.fetchApi).mockReturnValueOnce(reply.promise)
    const store = useAgentChatHistoryStore()
    store.replaceAll([session('agt_a', NOW)])
    const saving = store.rename('agt_a', 'Stale title')
    store.$dispose()
    reply.resolve(Response.json({ id: 'agt_a', title: 'Stale title' }))

    expect(await saving).toBe(false)
    expect(store.titleFor('agt_a')).toBe('agt_a')
  })

  it('does not restore a locally deleted thread on rename acknowledgement', async () => {
    vi.stubEnv('VITE_AGENT_BACKEND_MODE', 'official')
    const reply = Promise.withResolvers<Response>()
    vi.mocked(api.fetchApi)
      .mockReturnValueOnce(reply.promise)
      .mockResolvedValueOnce(Response.json({ id: 'agt_a' }))
    const store = useAgentChatHistoryStore()
    store.replaceAll([session('agt_a', NOW)])
    const saving = store.rename('agt_a', 'Removed title')
    await store.deleteThread('agt_a')
    reply.resolve(Response.json({ id: 'agt_a', title: 'Removed title' }))

    expect(await saving).toBe(false)
    expect(store.sessions).toEqual([])
  })

  it('waits for server deletion before hiding a native thread and coalesces repeat clicks', async () => {
    vi.stubEnv('VITE_AGENT_BACKEND_MODE', 'official')
    const reply = Promise.withResolvers<Response>()
    vi.mocked(api.fetchApi).mockReturnValueOnce(reply.promise)
    const store = useAgentChatHistoryStore()
    store.replaceAll([session('agt_a', NOW)])
    store.setActive('agt_a')

    const deleting = store.deleteThread('agt_a')
    const duplicate = store.deleteThread('agt_a')
    expect(store.sessions).toHaveLength(1)
    expect(api.fetchApi).toHaveBeenCalledOnce()
    reply.resolve(Response.json({ id: 'agt_a' }))

    expect(await deleting).toBe(true)
    expect(await duplicate).toBe(true)
    expect(store.sessions).toEqual([])
    expect(store.activeId).toBeNull()
    expect(api.fetchApi).toHaveBeenCalledWith(
      '/agent/threads/agt_a',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('keeps a native thread visible when server deletion fails', async () => {
    vi.stubEnv('VITE_AGENT_BACKEND_MODE', 'official')
    vi.mocked(api.fetchApi).mockResolvedValueOnce(
      Response.json({ error: 'no' }, { status: 503 })
    )
    const store = useAgentChatHistoryStore()
    store.replaceAll([session('agt_a', NOW)])

    expect(await store.deleteThread('agt_a')).toBe(false)
    expect(store.sessions.map(({ id }) => id)).toEqual(['agt_a'])
  })

  it('keeps upstream deletion local without sending a request', async () => {
    const store = useAgentChatHistoryStore()
    store.replaceAll([session('upstream', NOW)])

    expect(await store.deleteThread('upstream')).toBe(true)
    expect(store.sessions).toEqual([])
    expect(api.fetchApi).not.toHaveBeenCalled()
  })

  it('keeps upstream renames local without sending a request', async () => {
    const store = useAgentChatHistoryStore()

    expect(await store.rename('upstream', 'Local title')).toBe(true)
    expect(store.titleFor('upstream')).toBe('Local title')
    expect(api.fetchApi).not.toHaveBeenCalled()
  })

  it('holds a removed session out of later refreshes', async () => {
    const store = useAgentChatHistoryStore()
    store.replaceAll([session('a', 1), session('b', 2)])

    await store.deleteThread('a')
    store.replaceAll([session('a', 1), session('b', 2)])

    expect(store.sessions.map((s) => s.id)).toEqual(['b'])
  })

  it('clears the active id when the active session is removed', async () => {
    const store = useAgentChatHistoryStore()
    store.replaceAll([session('a', 1)])
    store.setActive('a')
    await store.deleteThread('a')

    expect(store.activeId).toBeNull()
    expect(store.sessions).toHaveLength(0)
  })

  it('keeps the active id when a different session is removed', async () => {
    const store = useAgentChatHistoryStore()
    store.replaceAll([session('a', 1), session('b', 2)])
    store.setActive('a')
    await store.deleteThread('b')

    expect(store.activeId).toBe('a')
  })

  it('restores titles and tombstones only from the current scope', () => {
    sessionStorage.setItem(
      'Comfy.Workspace.Current',
      JSON.stringify({ type: 'team', id: 'workspace-b' })
    )
    localStorage.setItem(
      StorageKeys.agentChatTitles('workspace-b'),
      JSON.stringify({ a: 'Scoped title' })
    )
    localStorage.setItem(
      StorageKeys.agentDeletedThreads('workspace-b'),
      JSON.stringify(['deleted'])
    )
    localStorage.setItem(
      'Comfy.Agent.ChatTitles',
      JSON.stringify({ a: 'Legacy title' })
    )
    localStorage.setItem(
      'Comfy.Agent.DeletedThreads',
      JSON.stringify(['visible'])
    )

    const store = useAgentChatHistoryStore()
    store.replaceAll([
      session('a', 1),
      session('deleted', 2),
      session('visible', 3)
    ])

    expect(store.titleFor('a')).toBe('Scoped title')
    expect(store.sessions.map(({ id }) => id)).toEqual(['a', 'visible'])
    expect(localStorage.getItem('Comfy.Agent.ChatTitles')).toBeNull()
    expect(localStorage.getItem('Comfy.Agent.DeletedThreads')).toBeNull()
  })

  it('does not apply titles or tombstones from another workspace', () => {
    sessionStorage.setItem(
      'Comfy.Workspace.Current',
      JSON.stringify({ type: 'team', id: 'workspace-b' })
    )
    localStorage.setItem(
      StorageKeys.agentChatTitles('workspace-a'),
      JSON.stringify({ a: 'Workspace A title' })
    )
    localStorage.setItem(
      StorageKeys.agentDeletedThreads('workspace-a'),
      JSON.stringify(['a'])
    )

    const store = useAgentChatHistoryStore()
    store.replaceAll([session('a', 1)])

    expect(store.titleFor('a')).toBeUndefined()
    expect(store.sessions.map(({ id }) => id)).toEqual(['a'])
  })

  it('removes a session with no server request', async () => {
    const store = useAgentChatHistoryStore()
    store.replaceAll([session('a', 1)])

    await store.deleteThread('a')

    expect(api.fetchApi).not.toHaveBeenCalled()
    expect(store.sessions).toHaveLength(0)
  })
})
