import { toValue } from 'vue'

import { useFeatureFlags } from '@/composables/useFeatureFlags'
import { assetResponseSchema } from '@/platform/assets/schemas/assetSchema'
import type { AssetItem } from '@/platform/assets/schemas/assetSchema'
import { api } from '@/scripts/api'
import { useAssetsStore } from '@/stores/assetsStore'
import { parseAnnotatedPath } from '@/utils/createAnnotatedPath'
import { encodeParams } from '@/utils/requestUtil'
import { isResultItemType } from '@/utils/typeGuardUtil'

import { getAssetSubfolder } from './assetUrlUtil'

/** Resolve a widget value to its asset: `null` when confirmed absent, `undefined` when unknown. */
export async function resolveWidgetValueAsset(
  widgetValue: string,
  { signal }: { signal?: AbortSignal } = {}
): Promise<AssetItem | null | undefined> {
  const { filepath, rootFolder } = parseAnnotatedPath(widgetValue)
  function assetMatches(asset: AssetItem, fallbackRoot: string): boolean {
    const type = asset.tags.find(isResultItemType) ?? fallbackRoot
    const storedName = asset.hash || asset.name
    const folder = getAssetSubfolder(asset)
    const path =
      asset.loader_path ||
      (folder && !storedName.startsWith(`${folder}/`)
        ? `${folder}/${storedName}`
        : storedName)
    return type === rootFolder && path === filepath
  }
  const assetsStore = useAssetsStore()
  const storedAsset =
    toValue(assetsStore.inputAssets.items).find((asset) =>
      assetMatches(asset, 'input')
    ) ??
    toValue(assetsStore.outputAssets.items).find((asset) =>
      assetMatches(asset, 'output')
    )
  if (storedAsset) return storedAsset

  if (!useFeatureFlags().flags.assetsEnabled) return undefined

  const slash = filepath.lastIndexOf('/')
  const query = encodeParams({
    limit: 1,
    hash: filepath.slice(slash + 1),
    include_tags: rootFolder,
    subfolder: slash < 0 ? '' : filepath.slice(0, slash)
  })
  const resp = await api.fetchApi(`/assets?${query}`, { signal })
  if (!resp.ok) return undefined
  const json = await resp.json().catch(() => {})
  const parseResult = assetResponseSchema.safeParse(json)
  return parseResult.success
    ? (parseResult.data.assets.find((asset) =>
        assetMatches(asset, rootFolder)
      ) ?? null)
    : undefined
}
