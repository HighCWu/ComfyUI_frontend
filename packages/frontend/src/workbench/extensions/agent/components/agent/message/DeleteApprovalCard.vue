<script setup lang="ts">
import type {
  AgentAnswerRequest,
  AgentPendingDeleteApproval
} from '@comfyorg/ingest-types'
import { useI18n } from 'vue-i18n'
import Button from '@/components/ui/button/Button.vue'
import type { AgentAskResolution } from '../../../services/agent/agentMessageParts'
import AskAnswerSummary from './AskAnswerSummary.vue'

const {
  approval,
  answering = false,
  resolution
} = defineProps<{
  approval: AgentPendingDeleteApproval
  answering?: boolean
  resolution?: AgentAskResolution
}>()
const emit = defineEmits<{
  answer: [askId: string, selection: AgentAnswerRequest]
}>()
const { t } = useI18n()
</script>

<template>
  <section
    class="flex flex-col gap-3 rounded-lg border border-component-node-border bg-secondary-background p-4 shadow-interface"
    :aria-label="t('agent.deleteApproval.title')"
    @keydown.stop
  >
    <p class="m-0 text-sm whitespace-pre-line text-base-foreground">
      {{ approval.prompt }}
    </p>
    <ul
      class="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground"
    >
      <li
        v-for="node in approval.context.nodes"
        :key="node.id"
        class="wrap-break-word"
      >
        {{
          node.title ||
          node.type ||
          t('agent.deleteApproval.node', { id: node.id })
        }}
      </li>
    </ul>
    <p
      v-if="approval.context.hidden_node_count"
      class="m-0 text-sm text-muted-foreground"
    >
      {{
        t(
          'agent.deleteApproval.more',
          { count: approval.context.hidden_node_count },
          approval.context.hidden_node_count
        )
      }}
    </p>
    <AskAnswerSummary
      v-if="resolution"
      :resolution
      :options="approval.options"
    />
    <div v-else class="flex justify-end gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        :disabled="answering"
        :aria-busy="answering || undefined"
        @click="emit('answer', approval.ask_id, { selected: ['keep'] })"
        >{{ t('agent.deleteApproval.keep') }}</Button
      >
      <Button
        type="button"
        variant="destructive"
        size="sm"
        :disabled="answering"
        :aria-busy="answering || undefined"
        @click="emit('answer', approval.ask_id, { selected: ['delete'] })"
        >{{ t('agent.deleteApproval.delete') }}</Button
      >
    </div>
  </section>
</template>
