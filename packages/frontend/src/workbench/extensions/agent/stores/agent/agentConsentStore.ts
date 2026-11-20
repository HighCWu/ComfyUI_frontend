import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { useCurrentUser } from '@/composables/auth/useCurrentUser'
import {
  webSessionRequests,
  webSessionSend
} from '@/platform/auth/session/webSessionFetch'
import { AGENT_CONSENT_SETTING_ID } from '@/platform/settings/constants/agent'
import {
  getGlobalSetting,
  setGlobalSetting
} from '@/platform/settings/globalSettingsApi'
import { useTeamWorkspaceStore } from '@/platform/workspace/stores/teamWorkspaceStore'
import { useAuthStore } from '@/stores/authStore'

class AgentConsentAuthenticationError extends Error {
  override name = 'AgentConsentAuthenticationError'
}

export const useAgentConsentStore = defineStore('agentConsent', () => {
  const authStore = useAuthStore()
  const workspaceStore = useTeamWorkspaceStore()
  const { resolvedUserInfo } = useCurrentUser()
  const loadedIdentity = ref<string | null>(null)
  const acceptedIdentity = ref<string | null>(null)
  const checkSettled = ref(false)
  const isChecking = computed(
    () => Boolean(currentUserId()) && !checkSettled.value
  )
  let session = 0
  let pendingLoad: { identity: string; result: Promise<boolean> } | null = null

  function currentUserId(): string | undefined {
    return resolvedUserInfo.value?.id
  }

  function currentIdentity(): string | null {
    const userId = currentUserId()
    if (import.meta.env.VITE_RUN_BILLING_MODE === 'prepaid') {
      return userId ? JSON.stringify([userId, 'account']) : null
    }
    const workspaceId = workspaceStore.activeWorkspaceId
    if (!userId || !workspaceId || workspaceStore.isSwitching) return null
    return JSON.stringify([
      userId,
      workspaceId,
      workspaceStore.workspaceTransitionGeneration
    ])
  }
  const identity = computed(currentIdentity)
  const accepted = computed(
    () =>
      currentIdentity() !== null && acceptedIdentity.value === currentIdentity()
  )

  watch(
    currentIdentity,
    () => {
      session += 1
      pendingLoad = null
      loadedIdentity.value = null
      acceptedIdentity.value = null
      checkSettled.value = false
    },
    { flush: 'sync' }
  )

  async function ensureScope(): Promise<string | null> {
    const userId = currentUserId()
    if (!userId) {
      throw new AgentConsentAuthenticationError(
        'Comfy account authentication is required'
      )
    }
    if (import.meta.env.VITE_RUN_BILLING_MODE === 'prepaid')
      return currentIdentity()
    const generation = workspaceStore.workspaceTransitionGeneration
    if (!workspaceStore.activeWorkspaceId && !workspaceStore.isSwitching) {
      await workspaceStore.initialize()
    }
    if (
      currentUserId() !== userId ||
      workspaceStore.workspaceTransitionGeneration !== generation ||
      workspaceStore.isSwitching
    )
      return null
    const scope = currentIdentity()
    if (!scope) {
      throw new AgentConsentAuthenticationError(
        'Comfy workspace authentication is required'
      )
    }
    return scope
  }

  function stillOwns(sessionId: number, identity: string): boolean {
    return session === sessionId && currentIdentity() === identity
  }

  async function requireAuth(sessionId: number, identity: string) {
    if (import.meta.env.VITE_RUN_BILLING_MODE === 'prepaid') {
      if (!stillOwns(sessionId, identity)) return null
      return (url: string, init: RequestInit) =>
        fetch(url, { ...init, credentials: 'include' })
    }
    const send = webSessionRequests() ? await webSessionSend() : undefined
    const auth = send ?? (await authStore.getWorkspaceAuthHeader())
    if (!stillOwns(sessionId, identity)) return null
    if (!auth) {
      throw new AgentConsentAuthenticationError(
        'Comfy account authentication is required'
      )
    }
    return auth
  }

  async function readConsent(
    sessionId: number,
    identity: string
  ): Promise<boolean> {
    try {
      const auth = await requireAuth(sessionId, identity)
      if (!auth) return false
      const stored = await getGlobalSetting(AGENT_CONSENT_SETTING_ID, auth)
      if (!stillOwns(sessionId, identity)) return false
      if (loadedIdentity.value === identity) return accepted.value

      loadedIdentity.value = identity
      acceptedIdentity.value = stored?.value === true ? identity : null
      return accepted.value
    } catch (error) {
      if (!stillOwns(sessionId, identity)) return false
      throw error
    } finally {
      if (stillOwns(sessionId, identity)) checkSettled.value = true
    }
  }

  async function load(): Promise<boolean> {
    const initialSession = session
    let identity: string | null
    try {
      identity = await ensureScope()
    } catch (error) {
      if (session === initialSession) checkSettled.value = true
      throw error
    }
    if (!identity) return false
    if (loadedIdentity.value === identity) return accepted.value
    if (pendingLoad?.identity === identity) return pendingLoad.result

    const result = (async () => {
      // The prepaid identity bootstrap can briefly clear and restore the same
      // account while the first authenticated feature refresh settles. A read
      // from the earlier epoch must not commit, but an explicit panel click
      // must not be lost merely because the stable identity has the same key.
      // Bound retries so a genuinely unstable auth rail still fails closed.
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const value = await readConsent(session, identity)
        if (loadedIdentity.value === identity) return value
        const current = currentIdentity()
        if (current !== null && current !== identity) return false
        if (current === identity) continue
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      return false
    })()
    const request = { identity, result }
    pendingLoad = request
    try {
      return await result
    } finally {
      if (pendingLoad === request) pendingLoad = null
    }
  }

  async function accept(expectedIdentity?: string): Promise<boolean> {
    const identity = await ensureScope()
    if (!identity) return false
    if (expectedIdentity && identity !== expectedIdentity) return false

    const sessionId = session
    try {
      const auth = await requireAuth(sessionId, identity)
      if (!auth) return false
      await setGlobalSetting(
        { key: AGENT_CONSENT_SETTING_ID, value: true },
        auth
      )
      if (!stillOwns(sessionId, identity)) return false

      loadedIdentity.value = identity
      acceptedIdentity.value = identity
      checkSettled.value = true
      return true
    } catch (error) {
      if (!stillOwns(sessionId, identity)) return false
      throw error
    }
  }

  return { accepted, identity, isChecking, ensureScope, load, accept }
})
