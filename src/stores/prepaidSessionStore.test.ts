import { expect, it, vi } from 'vitest'

import { usePrepaidSessionStore } from './prepaidSessionStore'
import {
  remoteConfig,
  remoteConfigState,
  sessionAgentGrant
} from '@/platform/remoteConfig/remoteConfig'

it('invalidates prior account configuration before refreshing a prepaid session', async () => {
  vi.stubEnv('VITE_RUN_BILLING_MODE', 'prepaid')
  remoteConfig.value = { 'agent-in-app-experience': true }
  sessionAgentGrant.value = true
  vi.mocked(fetch).mockResolvedValue(Response.json(null))

  const refresh = usePrepaidSessionStore().refresh()

  expect(remoteConfig.value).toEqual({})
  expect(remoteConfigState.value).toBe('unloaded')
  expect(sessionAgentGrant.value).toBeUndefined()
  await refresh
})

it('does not restore an expired account from an earlier in-flight session read', async () => {
  let complete!: (response: Response) => void
  const delayed = new Promise<Response>((resolve) => {
    complete = resolve
  })
  vi.mocked(fetch)
    .mockReturnValueOnce(delayed)
    .mockResolvedValueOnce(Response.json(null))
  const store = usePrepaidSessionStore()
  const initial = store.initialize()
  await store.refresh()
  complete(
    Response.json({
      user: {
        id: 'expired',
        name: 'Old',
        email: 'old@example.test',
        emailVerified: true
      }
    })
  )
  await initial
  expect(store.user).toBeNull()
})

it('resolves the server identity and clears it when the session expires', async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      Response.json({
        user: {
          id: 'owner',
          name: 'QA',
          email: 'qa@example.test',
          emailVerified: true
        }
      })
    )
    .mockResolvedValueOnce(Response.json(null))
  const store = usePrepaidSessionStore()
  await store.initialize()
  expect(store.user?.id).toBe('owner')
  await store.refresh()
  expect(store.user).toBeNull()
  expect(store.initialized).toBe(true)
})

it.for([
  Response.json({ user: { id: 'forged' } }),
  new Response(null, { status: 401 })
])('rejects absent or malformed identities', async (response) => {
  vi.mocked(fetch).mockResolvedValue(response)
  const store = usePrepaidSessionStore()
  await store.initialize()
  expect(store.user).toBeNull()
  expect(store.initialized).toBe(true)
})
