import { useLocalStorage, useTimestamp } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'

import { clearLegacyAgentStorage } from '@/platform/workflow/persistence/base/storageIO'
import {
  getWorkspaceId,
  StorageKeys
} from '@/platform/workflow/persistence/base/storageKeys'

import { createAgentRestClient } from '../../services/agent/agentRestClient'

export interface ChatSession {
  id: string
  title: string
  updatedAt: number
  titleSource: 'server' | 'fallback'
}

export interface HistoryGroups {
  current: ChatSession[]
  today: ChatSession[]
  yesterday: ChatSession[]
  earlier: ChatSession[]
}

function startOfLocalDay(now: number): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function groupSessionsByRecency(
  sessions: ChatSession[],
  activeId: string | null,
  now: number
): HistoryGroups {
  const startToday = startOfLocalDay(now)
  const startYesterday = startOfLocalDay(startToday - 1)
  const groups: HistoryGroups = {
    current: [],
    today: [],
    yesterday: [],
    earlier: []
  }
  const ordered = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  for (const session of ordered) {
    if (session.id === activeId) groups.current.push(session)
    else if (session.updatedAt >= startToday) groups.today.push(session)
    else if (session.updatedAt >= startYesterday) groups.yesterday.push(session)
    else groups.earlier.push(session)
  }
  return groups
}

export const useAgentChatHistoryStore = defineStore('agentChatHistory', () => {
  const sessions = ref<ChatSession[]>([])
  const activeId = ref<string | null>(null)
  const now = useTimestamp({ interval: 60_000 })
  const workspaceId = getWorkspaceId()

  clearLegacyAgentStorage()

  const nativeMode = import.meta.env.VITE_AGENT_BACKEND_MODE === 'official'
  const rest = createAgentRestClient()
  const pendingRenames = new Set<string>()
  const pendingDeletes = new Map<string, Promise<boolean>>()
  const lifetime = new AbortController()
  onScopeDispose(() => {
    lifetime.abort()
  })
  const customTitles = useLocalStorage<Partial<Record<string, string>>>(
    StorageKeys.agentChatTitles(workspaceId),
    {}
  )
  const deletedIds = useLocalStorage<string[]>(
    StorageKeys.agentDeletedThreads(workspaceId),
    []
  )

  const titled = computed(() =>
    sessions.value.map((session) => {
      const custom = nativeMode ? undefined : customTitles.value[session.id]
      return custom === undefined ? session : { ...session, title: custom }
    })
  )

  const grouped = computed(() =>
    groupSessionsByRecency(titled.value, activeId.value, now.value)
  )

  function titleFor(id: string | null): string | undefined {
    if (id === null) return undefined
    if (!nativeMode) return customTitles.value[id]
    const session = sessions.value.find((item) => item.id === id)
    return session?.titleSource === 'server' ? session.title : undefined
  }

  async function rename(id: string, title: string): Promise<boolean> {
    const trimmed = title.trim()
    if (trimmed === '' || lifetime.signal.aborted) return false
    if (!nativeMode) {
      customTitles.value = { ...customTitles.value, [id]: trimmed }
      return true
    }
    if (trimmed.length > 200 || pendingRenames.has(id)) return false
    pendingRenames.add(id)
    const result = await rest.renameThread(id, trimmed, lifetime.signal)
    pendingRenames.delete(id)
    return result.ok && applyServerTitle(result.thread)
  }

  function applyServerTitle(
    thread: Pick<ChatSession, 'id' | 'title'>
  ): boolean {
    if (lifetime.signal.aborted || deletedIds.value.includes(thread.id))
      return false
    const existing = sessions.value.find((item) => item.id === thread.id)
    const renamed: ChatSession = {
      ...thread,
      updatedAt: existing?.updatedAt ?? Date.now(),
      titleSource: 'server'
    }
    sessions.value = existing
      ? sessions.value.map((item) => (item.id === thread.id ? renamed : item))
      : [...sessions.value, renamed]
    return true
  }

  function remove(id: string): void {
    sessions.value = sessions.value.filter((item) => item.id !== id)
    const { [id]: _removed, ...rest } = customTitles.value
    customTitles.value = rest
    if (!deletedIds.value.includes(id))
      deletedIds.value = [...deletedIds.value, id]
    if (activeId.value === id) activeId.value = null
  }

  async function deleteThread(id: string): Promise<boolean> {
    if (lifetime.signal.aborted) return false
    if (!nativeMode) {
      remove(id)
      return true
    }
    const pending = pendingDeletes.get(id)
    if (pending) return pending
    const deletion = (async () => {
      const result = await rest.deleteThread(id, lifetime.signal)
      if (!result.ok || lifetime.signal.aborted) return false
      remove(id)
      return true
    })()
    pendingDeletes.set(id, deletion)
    try {
      return await deletion
    } finally {
      if (pendingDeletes.get(id) === deletion) pendingDeletes.delete(id)
    }
  }

  function replaceAll(next: ChatSession[]): void {
    sessions.value = next.filter(
      (session) => !deletedIds.value.includes(session.id)
    )
  }

  function setActive(id: string | null): void {
    activeId.value = id
  }

  return {
    sessions,
    activeId,
    grouped,
    titleFor,
    rename,
    deleteThread,
    replaceAll,
    setActive
  }
})
