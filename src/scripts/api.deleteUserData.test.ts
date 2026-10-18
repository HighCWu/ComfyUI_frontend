import { expect, it, vi } from 'vitest'

import { api } from '@/scripts/api'

it('forwards conditional deletion headers and preserves a precondition refusal', async () => {
  const response = new Response(null, { status: 412 })
  const fetchApi = vi.spyOn(api, 'fetchApi').mockResolvedValueOnce(response)
  const etag = `"native-v1-${'a'.repeat(64)}-11111111-1111-4111-8111-111111111111"`
  const deleted = await api.deleteUserData('workflows/Portrait.json', {
    headers: { 'If-Match': etag }
  })
  expect(fetchApi).toHaveBeenCalledExactlyOnceWith(
    '/userdata/workflows%2FPortrait.json',
    {
      method: 'DELETE',
      headers: { 'If-Match': etag }
    }
  )
  expect(deleted.status).toBe(412)
})

it('preserves deletion without a previously loaded validator', async () => {
  const fetchApi = vi
    .spyOn(api, 'fetchApi')
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  expect((await api.deleteUserData('workflows/Portrait.json')).status).toBe(204)
  expect(fetchApi).toHaveBeenCalledExactlyOnceWith(
    '/userdata/workflows%2FPortrait.json',
    { method: 'DELETE' }
  )
})
