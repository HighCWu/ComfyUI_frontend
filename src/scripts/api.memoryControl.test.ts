import { expect, it, vi } from 'vitest'

import { useToast } from '@/components/ui/toast/toastStore'
import { api } from '@/scripts/api'

it.for([false, true])(
  'shows failure rather than cleanup success when shared-Pool control is unavailable (clear cache: %s)',
  async (freeExecutionCache) => {
    const fetchApi = vi.spyOn(api, 'fetchApi').mockResolvedValueOnce(
      Response.json(
        {
          ok: false,
          code: 'MANUAL_MEMORY_CONTROL_UNAVAILABLE',
          free_memory: false,
          unload_models: false
        },
        { status: 409 }
      )
    )
    const toast = useToast()

    await api.freeMemory({ freeExecutionCache })

    expect(fetchApi).toHaveBeenCalledWith('/free', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: freeExecutionCache
        ? '{"unload_models": true, "free_memory": true}'
        : '{"unload_models": true}'
    })
    expect(toast.toasts.map(({ kind }) => kind)).toEqual(['error'])
  }
)
