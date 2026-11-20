import { describe, expect, it, vi } from 'vitest'

import { api } from '@/scripts/api'

import {
  createSecret,
  listSecretProviders,
  listSecrets,
  updateSecret
} from './secretsApi'

vi.mock(import('@/scripts/api'))

function jsonResponse(body: unknown, init: Partial<Response> = {}): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    ...init
  } as Response
}

describe('listSecretProviders', () => {
  it('requests the providers endpoint and returns the provider list', async () => {
    vi.mocked(api.fetchApi).mockResolvedValue(
      jsonResponse({ data: [{ id: 'huggingface' }, { id: 'civitai' }] })
    )

    const providers = await listSecretProviders()

    expect(api.fetchApi).toHaveBeenCalledWith('/secrets/providers')
    expect(providers).toEqual([{ id: 'huggingface' }, { id: 'civitai' }])
  })

  it('passes through per-provider credential options and label metadata', async () => {
    vi.mocked(api.fetchApi).mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'gemini',
            label: 'Gemini',
            credential_options: [
              {
                credential_type: 'gcp_service_account',
                input_type: 'json_file',
                label: 'Service account (Vertex AI)'
              }
            ]
          }
        ]
      })
    )

    const providers = await listSecretProviders()

    expect(providers).toEqual([
      {
        id: 'gemini',
        label: 'Gemini',
        credential_options: [
          {
            credential_type: 'gcp_service_account',
            input_type: 'json_file',
            label: 'Service account (Vertex AI)'
          }
        ]
      }
    ])
  })

  it('rejects a successful provider response when data is missing', async () => {
    vi.mocked(api.fetchApi).mockResolvedValue(jsonResponse({}))

    await expect(listSecretProviders()).rejects.toMatchObject({
      name: 'SecretsApiError',
      status: 200,
      message: 'Secret request returned an invalid response'
    })
  })

  it('throws SecretsApiError on a failed response', async () => {
    vi.mocked(api.fetchApi).mockResolvedValue(
      jsonResponse(
        { message: 'unavailable' },
        { ok: false, status: 503, statusText: 'Service Unavailable' }
      )
    )

    await expect(listSecretProviders()).rejects.toMatchObject({
      name: 'SecretsApiError',
      status: 503,
      message: 'unavailable'
    })
  })

  it('preserves a recognized error code on SecretsApiError', async () => {
    vi.mocked(api.fetchApi).mockResolvedValue(
      jsonResponse(
        { code: 'DUPLICATE_NAME', message: 'exists' },
        { ok: false, status: 409, statusText: 'Conflict' }
      )
    )

    await expect(listSecretProviders()).rejects.toMatchObject({
      name: 'SecretsApiError',
      status: 409,
      code: 'DUPLICATE_NAME',
      message: 'exists'
    })
  })
})

describe('secret metadata responses', () => {
  const metadata = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    name: 'Hugging Face',
    provider: 'huggingface',
    credential_type: 'api_key' as const,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z'
  }

  it('validates list, create and update metadata responses', async () => {
    vi.mocked(api.fetchApi)
      .mockResolvedValueOnce(jsonResponse({ data: [metadata] }))
      .mockResolvedValueOnce(jsonResponse(metadata, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse(metadata))

    await expect(listSecrets()).resolves.toEqual([metadata])
    await expect(
      createSecret({
        name: 'Hugging Face',
        provider: 'huggingface',
        secret_value: 'token'
      })
    ).resolves.toEqual(metadata)
    await expect(
      updateSecret(metadata.id, { name: 'Hugging Face' })
    ).resolves.toEqual(metadata)
  })

  it.for([
    { operation: 'list', response: { data: [{ ...metadata, id: 'invalid' }] } },
    { operation: 'create', response: { ...metadata, created_at: 'today' } },
    { operation: 'update', response: { ...metadata, secret_value: 'leaked' } }
  ])(
    'rejects malformed $operation metadata',
    async ({ operation, response }) => {
      vi.mocked(api.fetchApi).mockResolvedValue(jsonResponse(response))

      const request =
        operation === 'list'
          ? listSecrets()
          : operation === 'create'
            ? createSecret({ name: 'Secret', secret_value: 'token' })
            : updateSecret(metadata.id, { name: 'Secret' })

      await expect(request).rejects.toMatchObject({
        name: 'SecretsApiError',
        status: 200,
        message: 'Secret request returned an invalid response'
      })
    }
  )
})
