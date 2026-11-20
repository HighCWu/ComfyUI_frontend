import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { z } from 'zod'
import { invalidateRemoteConfig } from '@/platform/remoteConfig/refreshRemoteConfig'
import { prepaidSessionSchema } from './prepaidSessionSchema'

export const usePrepaidSessionStore = defineStore('prepaidSession', () => {
  const user = ref<z.infer<typeof prepaidSessionSchema>['user'] | null>(null)
  const socketScope = ref<string | null>(null)
  const initialized = ref(false)
  let pending: Promise<void> | undefined
  let generation = 0

  async function fetchSession(controller: AbortController) {
    const response = await fetch('/api/auth/get-session', {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal
    })
    if (!response.ok) return null
    return prepaidSessionSchema.safeParse(await response.json())
  }

  /** Applies a fetched session when it is still the current refresh generation. */
  function applySessionResult(
    result: Awaited<ReturnType<typeof fetchSession>>,
    signal: AbortSignal,
    current: number
  ): void {
    if (current !== generation || signal.aborted || !result?.success) return
    user.value = result.data.user
    socketScope.value = result.data.socket_scope ?? null
  }

  async function refresh() {
    const current = ++generation
    if (import.meta.env.VITE_RUN_BILLING_MODE === 'prepaid')
      invalidateRemoteConfig()
    user.value = null
    socketScope.value = null
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      applySessionResult(
        await fetchSession(controller),
        controller.signal,
        current
      )
    } catch {
      if (current === generation) user.value = null
    } finally {
      clearTimeout(timeout)
      if (current === generation) initialized.value = true
    }
  }

  function initialize() {
    if (initialized.value) return Promise.resolve()
    return (pending ??= refresh().finally(() => {
      pending = undefined
    }))
  }

  async function signOut(): Promise<boolean> {
    try {
      const response = await fetch('/api/auth/session', {
        method: 'DELETE',
        credentials: 'include'
      })
      if (!response.ok) return false
      await refresh()
      return true
    } catch {
      return false
    }
  }

  return { user, socketScope, initialized, initialize, refresh, signOut }
})
