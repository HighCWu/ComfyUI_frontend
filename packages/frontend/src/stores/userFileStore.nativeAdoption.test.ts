import { expect, it, vi } from 'vitest'
import { api } from '@/scripts/api'
import { refreshNativeFileValidator, UserFile } from './userFileStore'

const path = 'workflows/Portrait.json'
const graph = '{"nodes":[],"links":[]}'
const etag = `"native-v1-${'a'.repeat(64)}-11111111-1111-4111-8111-111111111111"`

it('retains the adopted base validator for subsequent edits without replacing local content', async () => {
  const file = new UserFile(path, 123, 100)
  file.content = '{"nodes":[],"links":[],"extra":{"local":true}}'
  file.originalContent = graph
  vi.spyOn(api, 'getUserData').mockImplementation(
    async () => new Response(graph, { headers: { ETag: etag } })
  )
  vi.spyOn(api, 'storeUserData').mockImplementation(async () =>
    Response.json({ path, modified: 456, size: 54 })
  )
  expect(await refreshNativeFileValidator(file, path, graph)).toBe(true)
  expect(file.originalContent).toBe(graph)
  expect(file.content).toBe('{"nodes":[],"links":[],"extra":{"local":true}}')
  await file.save({ force: true })
  expect(api.storeUserData).toHaveBeenCalledWith(
    path,
    '{"nodes":[],"links":[],"extra":{"local":true}}',
    expect.objectContaining({ headers: { 'If-Match': etag } })
  )
})

it.for([
  {
    label: 'different remote graph',
    body: '{"nodes":[],"links":[],"extra":{}}',
    validator: etag
  },
  { label: 'ordinary validator', body: graph, validator: '"ordinary"' }
])('refuses $label without rebasing the file', async ({ body, validator }) => {
  const file = new UserFile(path, 123, 100)
  file.content = graph
  file.originalContent = graph
  vi.spyOn(api, 'getUserData').mockResolvedValue(
    new Response(body, { headers: { ETag: validator } })
  )
  expect(await refreshNativeFileValidator(file, path, graph)).toBe(false)
  expect(file.content).toBe(graph)
  expect(file.originalContent).toBe(graph)
})
