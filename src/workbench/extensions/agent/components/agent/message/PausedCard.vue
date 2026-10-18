<script setup lang="ts">
import type {
  AgentAnswerRequest,
  AgentPendingPaused
} from '@comfyorg/ingest-types'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/button/Button.vue'

const { paused, answering = false } = defineProps<{
  paused: AgentPendingPaused
  answering?: boolean
}>()
const emit = defineEmits<{
  answer: [askId: string, selection: AgentAnswerRequest]
}>()
const { t } = useI18n()
</script>

<template>
  <section
    class="flex flex-col gap-3 rounded-lg border border-component-node-border bg-secondary-background p-4 shadow-interface"
    :aria-label="t('agent.paused.title')"
    @keydown.stop
  >
    <p class="m-0 text-sm text-base-foreground">
      {{ t('agent.paused.title') }}
    </p>
    <p class="m-0 text-sm whitespace-pre-line text-muted-foreground">
      {{ paused.context.message }}
    </p>
    <p class="m-0 text-sm text-muted-foreground">
      {{ t('agent.paused.notice') }}
    </p>
    <div class="flex justify-end">
      <Button
        type="button"
        variant="primary"
        size="sm"
        :disabled="answering"
        :aria-busy="answering || undefined"
        @click="emit('answer', paused.ask_id, { selected: ['resume'] })"
      >
        {{ t('agent.paused.resume') }}
      </Button>
    </div>
  </section>
</template>
