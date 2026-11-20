<template>
  <ModelInfoField :label="t('assetBrowser.modelInfo.source')">
    <a
      v-if="sourceUrl"
      :href="sourceUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex items-center gap-1.5 text-muted-foreground no-underline transition-colors hover:text-base-foreground"
    >
      <img v-if="sourceLogo" :src="sourceLogo" alt="" class="size-4 shrink-0" />
      {{ t('assetBrowser.modelInfo.viewOnSource', { source: sourceName }) }}
      <i class="icon-[lucide--external-link] size-4 shrink-0" />
    </a>
    <span v-else class="text-muted-foreground">{{
      t('assetBrowser.modelInfo.notProvided')
    }}</span>
  </ModelInfoField>
  <ModelInfoField :label="t('assetBrowser.modelInfo.license')">
    <span class="break-words text-muted-foreground">{{
      details?.license || t('assetBrowser.modelInfo.notProvided')
    }}</span>
  </ModelInfoField>
  <ModelInfoField :label="t('assetBrowser.modelInfo.publisher')">
    <span class="break-words text-muted-foreground">{{
      details?.publisher_name || t('assetBrowser.modelInfo.notProvided')
    }}</span>
  </ModelInfoField>
  <ModelInfoField :label="t('assetBrowser.modelInfo.cacheStatus')">
    <span class="text-muted-foreground">{{ cacheStatus }}</span>
    <p class="text-xs leading-relaxed text-muted-foreground">
      {{ t('assetBrowser.modelInfo.cacheStatusHint') }}
    </p>
  </ModelInfoField>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { z } from 'zod'

import type { AssetItem } from '@/platform/assets/schemas/assetSchema'
import {
  getAssetSourceUrl,
  getSourceName
} from '@/platform/assets/utils/assetMetadataUtils'
import { getProviderLogo } from '@/platform/secrets/providers'

import ModelInfoField from './ModelInfoField.vue'

const { asset } = defineProps<{ asset: AssetItem }>()
const { t } = useI18n()
const catalogueSchema = z.object({
  source_url: z.string().nullable(),
  license: z.string().nullable(),
  publisher_name: z.string().nullable(),
  r2_cache_status: z.enum(['registered', 'not_registered'])
})
const details = computed(() => {
  const parsed = catalogueSchema.safeParse(asset.metadata?.laimon_model)
  return parsed.success ? parsed.data : null
})
const sourceUrl = computed(() => {
  const raw = details.value?.source_url ?? getAssetSourceUrl(asset)
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
})
const sourceName = computed(() =>
  sourceUrl.value ? getSourceName(sourceUrl.value) : ''
)
const sourceLogo = computed(() =>
  getProviderLogo(
    sourceName.value === 'Civitai'
      ? 'civitai'
      : sourceName.value === 'Hugging Face'
        ? 'huggingface'
        : undefined
  )
)
const cacheStatus = computed(() => {
  if (details.value?.r2_cache_status === 'registered')
    return t('assetBrowser.modelInfo.cacheRegistered')
  if (details.value?.r2_cache_status === 'not_registered')
    return t('assetBrowser.modelInfo.catalogueOnly')
  return t('assetBrowser.modelInfo.cacheUnknown')
})
</script>
