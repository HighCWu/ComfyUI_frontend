import { useCurrentUser } from '@/composables/auth/useCurrentUser'
import { useCloudWebSessionStore } from '@/platform/auth/session/cloudWebSessionStore'
import { usePrepaidSessionStore } from '@/stores/prepaidSessionStore'

export function useEmbeddedFollowerSession() {
  const { resolvedUserInfo } = useCurrentUser()
  const prepaid = usePrepaidSessionStore()
  const cloud = useCloudWebSessionStore()
  return {
    userId: () => resolvedUserInfo.value?.id ?? null,
    sessionScope: () =>
      import.meta.env.VITE_RUN_BILLING_MODE === 'prepaid'
        ? prepaid.socketScope
        : cloud.state.phase === 'signed_in'
          ? (cloud.state.session.socketScope ?? null)
          : null
  }
}
