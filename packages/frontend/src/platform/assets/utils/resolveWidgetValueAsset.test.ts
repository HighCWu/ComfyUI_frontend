import { describe, expect, it, vi } from 'vitest'

import { useFeatureFlags } from '@/composables/useFeatureFlags'
import { assetItemSchema } from '@/platform/assets/schemas/assetSchema'
import type { AssetItem } from '@/platform/assets/schemas/assetSchema'
import { api } from '@/scripts/api'
import { useAssetsStore } from '@/stores/assetsStore'

import { resolveWidgetValueAsset } from './resolveWidgetValueAsset'

vi.mock(import('@/scripts/api'))
vi.mock(import('@/composables/useFeatureFlags'))

function asset(id: string, type = 'input', subfolder = ''): AssetItem {
  return assetItemSchema.parse({
    id,
    name: 'same.png',
    hash: 'same.png',
    tags: [type],
    user_metadata: { subfolder },
    created_at: '2026-10-16T00:00:00Z',
    updated_at: '2026-10-16T00:00:00Z'
  })
}

function list(items: AssetItem[]) {
  return {
    items,
    hasMore: false,
    isLoading: false,
    invalidate: async () => {},
    loadMore: async () => false,
    loadNew: async () => {}
  }
}

describe('exact widget media identity', () => {
  it('does not select a cached input for an output annotation', async () => {
    const store = useAssetsStore()
    store.inputAssets = list([asset('input')])
    store.outputAssets = list([asset('output', 'output')])
    expect((await resolveWidgetValueAsset('same.png [output]'))?.id).toBe(
      'output'
    )
  })

  it('matches the full cached subfolder rather than another basename', async () => {
    const store = useAssetsStore()
    store.inputAssets = list([
      asset('root'),
      asset('nested', 'input', '目录/a%20')
    ])
    store.outputAssets = list([])
    expect((await resolveWidgetValueAsset('目录/a%20/same.png'))?.id).toBe(
      'nested'
    )
  })

  it('sends class and exact folder constraints on a cache miss', async () => {
    const store = useAssetsStore()
    store.inputAssets = list([])
    store.outputAssets = list([])
    vi.mocked(useFeatureFlags().flags).assetsEnabled = true
    vi.mocked(api.fetchApi).mockImplementation(async () =>
      Response.json({
        assets: [asset('remote', 'output', '目录/a%20')],
        total: 1,
        has_more: false
      })
    )
    expect(
      (await resolveWidgetValueAsset('目录/a%20/same.png [output]'))?.id
    ).toBe('remote')
    expect(
      Object.fromEntries(
        new URL(
          vi
            .mocked(api.fetchApi)
            .mock.calls.find(([url]) => url.includes('hash='))![0],
          'https://local.test'
        ).searchParams
      )
    ).toEqual({
      limit: '1',
      hash: 'same.png',
      include_tags: 'output',
      subfolder: '目录/a%20'
    })
  })

  it('does not mark a failed lookup as confirmed missing', async () => {
    const store = useAssetsStore()
    store.inputAssets = list([])
    store.outputAssets = list([])
    vi.mocked(useFeatureFlags().flags).assetsEnabled = true
    vi.mocked(api.fetchApi).mockImplementation(async () =>
      Response.json({ assets: [], total: 0, has_more: false }, { status: 503 })
    )
    expect(await resolveWidgetValueAsset('same.png')).toBeUndefined()
  })
})
