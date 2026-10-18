import { z } from 'zod'

import { useFeatureFlags } from '@/composables/useFeatureFlags'
import { assetItemSchema } from '@/platform/assets/schemas/assetSchema'
import { assetService } from '@/platform/assets/services/assetService'
import { api } from '@/scripts/api'
import { useAssetsStore } from '@/stores/assetsStore'

import { getAssetContentId } from './assetUrlUtil'

interface AssetRecord {
  id: string
  name: string
  hash?: string | null
  preview_url?: string
  preview_id?: string | null
  user_metadata?: Record<string, unknown>
}

const assetPreviewLookupResponseSchema = z.object({
  assets: z.array(
    assetItemSchema.pick({
      id: true,
      name: true,
      hash: true,
      preview_url: true,
      preview_id: true,
      user_metadata: true
    })
  ),
  has_more: z.boolean()
})

/**
 * Whether the backend can serve asset preview/thumbnail data.
 */
export function isAssetPreviewSupported(): boolean {
  return useFeatureFlags().flags.assetsEnabled
}

async function fetchAssets(
  params: Record<string, string>
): Promise<AssetRecord[] | undefined> {
  const query = new URLSearchParams({ ...params, include_tags: 'output' })
  const res = await api.fetchApi(`/assets?${query}`)
  if (!res.ok) return undefined
  const parsed = assetPreviewLookupResponseSchema.safeParse(await res.json())
  if (!parsed.success) return undefined
  const data = parsed.data
  if (data.has_more) return undefined
  return data.assets
}

export function resolvePreviewUrl(asset: AssetRecord): string {
  if (asset.preview_url) return api.apiURL(asset.preview_url)

  const contentId = asset.preview_id ?? getAssetContentId(asset)
  return api.apiURL(`/assets/${contentId}/content`)
}

/**
 * Find an output asset record by content hash, falling back to name.
 * On cloud, output filenames are content-hashed; use hash to match.
 * On local, filenames are not hashed; use name_contains to match.
 */
export async function findOutputAsset(
  name: string
): Promise<AssetRecord | undefined> {
  const byHash = await fetchAssets({ hash: name })
  if (!byHash) return undefined
  const hashMatches = byHash.filter((asset) => asset.hash === name)
  if (hashMatches.length)
    return hashMatches.length === 1 ? hashMatches[0] : undefined

  const byName = await fetchAssets({ name_contains: name })
  const nameMatches = byName?.filter((asset) => asset.name === name)
  return nameMatches?.length === 1 ? nameMatches[0] : undefined
}

export async function findServerPreviewUrl(
  name: string
): Promise<string | null> {
  try {
    const asset = await findOutputAsset(name)
    if (!asset?.preview_id) return null

    return resolvePreviewUrl(asset)
  } catch {
    return null
  }
}

export async function persistThumbnail(
  name: string,
  blob: Blob
): Promise<void> {
  try {
    const asset = await findOutputAsset(name)
    if (!asset || asset.preview_id) return

    const previewFilename = `${asset.name}_preview.png`
    const uploaded = await assetService.uploadAssetFromBase64({
      data: await blobToDataUrl(blob),
      name: previewFilename,
      tags: ['output'],
      user_metadata: { filename: previewFilename }
    })

    await assetService.updateAsset(asset.id, {
      preview_id: uploaded.id
    })
    await useAssetsStore().outputAssets.invalidate()
  } catch {
    // Non-critical — client still shows the rendered thumbnail
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
