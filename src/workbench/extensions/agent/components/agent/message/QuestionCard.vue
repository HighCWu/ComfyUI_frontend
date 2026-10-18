<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  AgentAnswerRequest,
  AgentPendingAskUser
} from '@comfyorg/ingest-types'
import Button from '@/components/ui/button/Button.vue'
import Checkbox from '@/components/ui/checkbox/Checkbox.vue'
import Field from '@/components/ui/field/Field.vue'
import FieldGroup from '@/components/ui/field/FieldGroup.vue'
import FieldLabel from '@/components/ui/field/FieldLabel.vue'
import Textarea from '@/components/ui/textarea/Textarea.vue'
import type { AgentAskResolution } from '../../../services/agent/agentMessageParts'
import AskAnswerSummary from './AskAnswerSummary.vue'

const {
  question,
  answering = false,
  resolution
} = defineProps<{
  question: AgentPendingAskUser
  answering?: boolean
  resolution?: AgentAskResolution
}>()
const emit = defineEmits<{
  answer: [askId: string, selection: AgentAnswerRequest]
}>()
const { t } = useI18n()
const fieldId = useId()
const selected = ref<string[]>([])
const other = ref('')
const answerCount = computed(
  () =>
    selected.value.length + (question.allow_other && other.value.trim() ? 1 : 0)
)
const valid = computed(
  () =>
    answerCount.value >= question.min_selections &&
    answerCount.value <= question.max_selections
)

function choose(id: string): void {
  if (answering) return
  if (selected.value.includes(id))
    selected.value = selected.value.filter((value) => value !== id)
  else if (question.max_selections === 1) selected.value = [id]
  else if (selected.value.length < question.max_selections)
    selected.value = [...selected.value, id]
}

function submit(): void {
  if (!valid.value || answering) return
  emit('answer', question.ask_id, {
    selected: [...selected.value],
    ...(question.allow_other && other.value.trim()
      ? { other_text: other.value.trim() }
      : {})
  })
}
</script>

<template>
  <section
    v-if="resolution"
    class="flex flex-col gap-3 rounded-lg border border-component-node-border bg-secondary-background p-4 shadow-interface"
  >
    <p class="m-0 text-sm whitespace-pre-line text-base-foreground">
      {{ question.prompt }}
    </p>
    <AskAnswerSummary :resolution :options="question.options" />
  </section>
  <form
    v-else
    class="flex flex-col gap-3 rounded-lg border border-component-node-border bg-secondary-background p-4 shadow-interface"
    @submit.prevent="submit"
    @keydown.stop
  >
    <fieldset
      :disabled="answering"
      class="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
    >
      <legend class="mb-2 text-sm whitespace-pre-line text-base-foreground">
        {{ question.prompt }}
      </legend>
      <FieldGroup>
        <Field
          v-for="(option, index) in question.options"
          :key="option.id"
          orientation="horizontal"
        >
          <Checkbox
            :id="`${fieldId}-${index}`"
            :model-value="selected.includes(option.id)"
            :disabled="
              answering ||
              (question.max_selections > 1 &&
                !selected.includes(option.id) &&
                selected.length >= question.max_selections)
            "
            @update:model-value="choose(option.id)"
          />
          <FieldLabel
            :for="`${fieldId}-${index}`"
            class="min-w-0 wrap-break-word"
          >
            <span
              >{{ option.label
              }}<span
                v-if="option.description"
                class="block text-muted-foreground"
                >{{ option.description }}</span
              ></span
            >
          </FieldLabel>
        </Field>
        <Field v-if="question.allow_other">
          <FieldLabel :for="`${fieldId}-other`">{{
            t('agent.question.other')
          }}</FieldLabel>
          <Textarea
            :id="`${fieldId}-other`"
            v-model="other"
            :maxlength="2000"
            rows="2"
          />
        </Field>
      </FieldGroup>
    </fieldset>
    <Button
      type="submit"
      variant="primary"
      size="sm"
      class="self-end"
      :disabled="!valid || answering"
      :aria-busy="answering || undefined"
      >{{ t('agent.question.send') }}</Button
    >
  </form>
</template>
