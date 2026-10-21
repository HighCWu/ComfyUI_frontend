<script setup lang="ts">
import { useTimeoutFn } from '@vueuse/core'
import { PopoverAnchor, PopoverTrigger } from 'reka-ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { z } from 'zod'

import Popover from '@/components/ui/popover/Popover.vue'
import Button from '@/components/ui/button/Button.vue'
import PopoverContent from '@/components/ui/popover/PopoverContent.vue'
import RadioGroup from '@/components/ui/radio-group/RadioGroup.vue'
import RadioGroupItem from '@/components/ui/radio-group/RadioGroupItem.vue'
import { api } from '@/scripts/api'
import {
  prepaidRunStrategiesSchema,
  selectedPrepaidRunStrategy
} from '@/scripts/prepaidRunStrategy'

const { enabled } = defineProps<{ enabled: boolean }>()
const { t } = useI18n()
const mode = ref<'closed' | 'hover' | 'explicit'>('closed')
const data = ref<z.infer<typeof prepaidRunStrategiesSchema> | null>(null)
const state = ref<'loading' | 'ready' | 'failed'>('loading')
let restoreFocus = false
const open = computed({
  get: () => enabled && mode.value !== 'closed',
  set: (value) => {
    if (value) {
      restoreFocus = true
      mode.value = 'explicit'
    } else mode.value = 'closed'
  }
})
const { start: scheduleClose, stop: cancelClose } = useTimeoutFn(
  () => {
    if (mode.value === 'hover') mode.value = 'closed'
  },
  180,
  { immediate: false }
)
const controller = new AbortController()

function hover(event: PointerEvent) {
  if (event.pointerType === 'touch') return
  cancelClose()
  if (enabled && mode.value === 'closed') {
    restoreFocus = false
    mode.value = 'hover'
  }
}
function autoFocus(event: Event) {
  if (mode.value === 'hover') event.preventDefault()
}
function closeAutoFocus(event: Event) {
  if (!restoreFocus) event.preventDefault()
}
function pinHoveredPanel(event: MouseEvent) {
  if (mode.value !== 'hover') return
  event.preventDefault()
  event.stopImmediatePropagation()
  cancelClose()
  restoreFocus = true
  mode.value = 'explicit'
}

onMounted(async () => {
  if (!enabled) return
  try {
    const response = await api.fetchApi('/run-strategies', {
      signal: controller.signal
    })
    if (!response.ok) {
      state.value = 'failed'
      return
    }
    const result = prepaidRunStrategiesSchema.safeParse(await response.json())
    if (!result.success) {
      state.value = 'failed'
      return
    }
    if (controller.signal.aborted) return
    data.value = result.data
    if (result.data.default_strategy_id)
      selectedPrepaidRunStrategy.value = result.data.default_strategy_id
    state.value = 'ready'
  } catch {
    if (!controller.signal.aborted) state.value = 'failed'
  }
})
onUnmounted(() => controller.abort())
</script>

<template>
  <Popover v-model:open="open">
    <PopoverAnchor as-child>
      <div
        class="flex items-center gap-1"
        @pointerenter="hover"
        @pointerleave="scheduleClose()"
      >
        <slot />
        <PopoverTrigger v-if="enabled" as-child>
          <Button
            variant="secondary"
            size="icon"
            :aria-label="t('prepaidRun.strategies')"
            @click.capture="pinHoveredPanel"
          >
            <i class="icon-[lucide--cpu]" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
      </div>
    </PopoverAnchor>
    <PopoverContent
      v-if="enabled"
      side="bottom"
      align="end"
      class="max-w-[calc(100vw-1rem)]"
      :aria-label="t('prepaidRun.strategies')"
      @pointerenter="cancelClose()"
      @pointerleave="scheduleClose()"
      @open-auto-focus="autoFocus"
      @close-auto-focus="closeAutoFocus"
    >
      <div class="flex flex-col gap-3">
        <h3 class="m-0 text-sm font-medium">
          {{ t('prepaidRun.strategies') }}
        </h3>
        <p
          v-if="state === 'loading'"
          role="status"
          class="m-0 text-xs text-muted-foreground"
        >
          {{ t('prepaidRun.loading') }}
        </p>
        <p
          v-else-if="state === 'failed' || !data?.strategies.length"
          role="status"
          class="m-0 text-xs text-muted-foreground"
        >
          {{ t('prepaidRun.unavailable') }}
        </p>
        <RadioGroup
          v-else
          v-model="selectedPrepaidRunStrategy"
          class="flex-col"
          :aria-label="t('prepaidRun.strategies')"
        >
          <label
            v-for="strategy in data.strategies"
            :key="strategy.id"
            class="flex cursor-pointer items-start gap-3 rounded-md border border-border-subtle p-3"
          >
            <RadioGroupItem
              :value="strategy.id"
              :aria-label="strategy.name"
              class="mt-0.5"
            />
            <span class="flex min-w-0 flex-col gap-1">
              <span class="text-sm font-medium"
                >{{ strategy.name }} · {{ strategy.memory_gb }} GB</span
              >
              <span class="text-xs text-muted-foreground">{{
                t('prepaidRun.rate', {
                  amount: (
                    strategy.provider_hourly_milliusd_estimate / 1000
                  ).toFixed(3)
                })
              }}</span>
              <span class="text-xs text-muted-foreground">{{
                t('prepaidRun.coverage', {
                  percent: strategy.coverage_ceiling_bps / 100
                })
              }}</span>
            </span>
          </label>
        </RadioGroup>
        <p class="m-0 text-xs leading-relaxed text-muted-foreground">
          {{ t('prepaidRun.policy') }}
        </p>
        <a
          href="/billing/"
          target="_blank"
          rel="noopener noreferrer"
          class="text-xs text-muted-foreground underline"
          >{{ t('prepaidRun.details') }}</a
        >
      </div>
    </PopoverContent>
  </Popover>
</template>
