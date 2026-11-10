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

  async function refresh() {
    const current = ++generation
    if (import.meta.env.VITE_RUN_BILLING_MODE === 'prepaid')
      invalidateRemoteConfig()
    user.value = null
    socketScope.value = null
    try {
      const response = await fetch('/api/auth/get-session', {
        credentials: 'include',
        cache: 'no-store'
      })
      if (!response.ok) return
      const result = prepaidSessionSchema.safeParse(await response.json())
      if (current === generation && result.success) {
        user.value = result.data.user
        socketScope.value = result.data.socket_scope ?? null
      }
    } catch {
      if (current === generation) user.value = null
    } finally {
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
