<script setup lang="ts">
import { onMounted, onScopeDispose, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/button/Button.vue'

import {
  createNativeRunPlanClient,
  reloadWithNativeRunPlan
} from '../../services/agent/nativeRunPlanClient'

const { workflowId, disabled, prepareDraft, readDraft } = defineProps<{
  workflowId: string
  disabled: boolean
  prepareDraft: () => Promise<Record<string, unknown> | null>
  readDraft: () => Record<string, unknown> | null
}>()
const { t } = useI18n()
const client = createNativeRunPlanClient()
const controller = new AbortController()
const state = ref<
  'loading' | 'unavailable' | 'idle' | 'updating' | 'failed' | 'review'
>('loading')
onScopeDispose(() => controller.abort())
onMounted(async () => {
  const enabled = await client.enabled(controller.signal)
  if (!controller.signal.aborted) state.value = enabled ? 'idle' : 'unavailable'
})

async function update(): Promise<void> {
  if (disabled || !['idle', 'failed', 'review'].includes(state.value)) return
  state.value = 'updating'
  const draft = await prepareDraft()
  if (!draft || controller.signal.aborted) {
    state.value = 'failed'
    return
  }
  const json = JSON.stringify(draft)
  const result = await client.update(
    workflowId,
    draft,
    () => !disabled && JSON.stringify(readDraft()) === json,
    controller.signal
  )
  if (controller.signal.aborted) return
  if (!result) {
    state.value = 'failed'
    return
  }
  if (result.model_review_required) {
    state.value = 'review'
    return
  }
  if (!reloadWithNativeRunPlan(result.session_id)) state.value = 'failed'
}
</script>

<template>
  <div
    v-if="state !== 'loading' && state !== 'unavailable'"
    class="flex flex-col gap-2 rounded-lg border border-border-subtle p-3 text-xs text-muted-foreground"
  >
    <p class="m-0">{{ t('agent.runPlanUpdateDescription') }}</p>
    <p v-if="state === 'failed'" role="alert" class="m-0">
      {{ t('agent.runPlanUpdateFailed') }}
    </p>
    <p v-if="state === 'review'" role="alert" class="m-0">
      {{ t('agent.runPlanReviewRequired') }}
    </p>
    <Button
      type="button"
      variant="muted-textonly"
      size="sm"
      :disabled="disabled || state === 'updating'"
      @click="update"
    >
      <span aria-hidden="true" class="icon-[lucide--refresh-cw] size-4" />
      {{ t('agent.updateRunPlan') }}
    </Button>
  </div>
</template>
