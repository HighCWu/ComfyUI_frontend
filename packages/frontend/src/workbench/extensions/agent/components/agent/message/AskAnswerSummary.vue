<script setup lang="ts">
import type { AgentAskOption } from '@comfyorg/ingest-types'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { AgentAskResolution } from '../../../services/agent/agentMessageParts'

const { resolution, options } = defineProps<{
  resolution: AgentAskResolution
  options: AgentAskOption[]
}>()
const { t } = useI18n()

const answers = computed(() => {
  if (resolution.status !== 'answered') return []
  const labels = new Map(options.map(({ id, label }) => [id, label]))
  const selected = resolution.selected.map((id) => labels.get(id) ?? id)
  return resolution.otherText
    ? [
        ...selected,
        t('agent.question.otherAnswer', { text: resolution.otherText })
      ]
    : selected
})

const statusText: Record<AgentAskResolution['status'], string> = {
  answered: 'agent.question.answered',
  closed: 'agent.question.closed',
  retired: 'agent.question.retired',
  unconfirmed: 'agent.question.unconfirmed'
}
</script>

<template>
  <div role="status" class="flex min-w-0 flex-col gap-1 text-sm/5">
    <p class="m-0 text-muted-foreground">
      {{ t(statusText[resolution.status]) }}
    </p>
    <ul v-if="answers.length" class="m-0 flex list-none flex-col gap-1 p-0">
      <li
        v-for="(answer, index) in answers"
        :key="index"
        class="flex items-start gap-2 text-base-foreground"
      >
        <i class="mt-0.5 icon-[lucide--check] size-4 shrink-0" />
        <span class="min-w-0 wrap-break-word">{{ answer }}</span>
      </li>
    </ul>
  </div>
</template>
