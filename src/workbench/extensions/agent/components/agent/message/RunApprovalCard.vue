<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/button/Button.vue'

import type {
  RunApprovalPart,
  AgentAskSelection
} from '../../../services/agent/agentMessageParts'
import QuestionCard from './QuestionCard.vue'
import DeleteApprovalCard from './DeleteApprovalCard.vue'
import PausedCard from './PausedCard.vue'
import { agentBoundWorkflowIdKey } from '../agentBoundWorkflowId'

const { part, answering = false } = defineProps<{
  part: RunApprovalPart
  answering?: boolean
}>()
const boundWorkflowId = inject(agentBoundWorkflowIdKey, ref(undefined))
const hideWorkflowName = computed(
  () => !!boundWorkflowId.value && part.workflowId === boundWorkflowId.value
)
const emit = defineEmits<{
  answer: [askId: string, selection: AgentAskSelection]
  openWorkflow: [askId: string, workflowId: string, workflowName?: string]
  shown: [askId: string, workflowId: string | null]
}>()

onMounted(() => {
  if (!part.question && !part.deletion && !part.paused)
    emit('shown', part.askId, part.workflowId ?? null)
})

const { t } = useI18n()
const workflowLabel = computed(
  () =>
    part.workflowName?.trim() ||
    part.workflowId?.trim() ||
    t('agent.runApproval.thisWorkflow')
)
</script>

<template>
  <PausedCard
    v-if="part.paused"
    :key="part.paused.ask_id"
    :paused="part.paused"
    :answering
    @answer="(askId, selection) => emit('answer', askId, selection)"
  />
  <DeleteApprovalCard
    v-else-if="part.deletion"
    :key="part.deletion.ask_id"
    :approval="part.deletion"
    :answering
    :resolution="part.resolution"
    @answer="(askId, selection) => emit('answer', askId, selection)"
  />
  <QuestionCard
    v-else-if="part.question"
    :key="part.question.ask_id"
    :question="part.question"
    :answering
    :resolution="part.resolution"
    @answer="(askId, selection) => emit('answer', askId, selection)"
  />
  <div
    v-else
    data-testid="agent-run-approval-card"
    class="flex w-full flex-col gap-2 overflow-hidden rounded-lg border border-component-node-border bg-secondary-background p-4 shadow-interface"
  >
    <div class="flex min-w-0 flex-col gap-0.5 text-sm/5">
      <p class="m-0 text-base-foreground">
        {{
          t(
            hideWorkflowName
              ? 'agent.runApproval.leadBound'
              : 'agent.runApproval.lead'
          )
        }}
      </p>
      <ul
        v-if="!hideWorkflowName"
        class="m-0 min-w-0 list-disc pl-5 text-muted-foreground"
      >
        <li>
          <Button
            v-if="part.workflowId"
            type="button"
            variant="link"
            size="unset"
            class="max-w-full justify-start text-left font-normal wrap-break-word whitespace-normal text-inherit underline underline-offset-2"
            @click="
              emit(
                'openWorkflow',
                part.askId,
                part.workflowId,
                part.workflowName
              )
            "
          >
            {{ workflowLabel }}
          </Button>
          <span v-else class="wrap-break-word underline underline-offset-2">
            {{ workflowLabel }}
          </span>
        </li>
      </ul>
      <p class="m-0 text-muted-foreground">
        {{ t('agent.runApproval.question') }}
      </p>
      <p
        v-if="part.prompt?.trim()"
        class="m-0 wrap-break-word whitespace-pre-line text-muted-foreground"
      >
        {{ part.prompt }}
      </p>
    </div>

    <div class="flex h-6 w-full justify-end gap-2">
      <Button
        data-testid="agent-run-approval-cancel"
        variant="secondary"
        size="sm"
        :disabled="answering"
        :aria-busy="answering || undefined"
        @click="emit('answer', part.askId, 'cancel')"
      >
        {{ t('agent.runApproval.cancel') }}
      </Button>
      <Button
        data-testid="agent-run-approval-run"
        variant="primary"
        size="sm"
        :disabled="answering"
        :aria-busy="answering || undefined"
        @click="emit('answer', part.askId, 'run')"
      >
        {{ t('agent.runApproval.run') }}
      </Button>
    </div>
  </div>
</template>
