<template>
  <component :is="currentButton" :key="canRun ? 'queue' : 'subscribe'" />
</template>
<script setup lang="ts">
import { computed } from 'vue'

import ComfyQueueButton from '@/components/actionbar/ComfyRunButton/ComfyQueueButton.vue'
import { useBillingContext } from '@/composables/billing/useBillingContext'
import SubscribeToRunButton from '@/platform/cloud/subscription/components/SubscribeToRun.vue'

const { isActiveSubscription } = useBillingContext()
const canRun = computed(
  () =>
    import.meta.env.VITE_RUN_BILLING_MODE === 'prepaid' ||
    isActiveSubscription.value
)

const currentButton = computed(() =>
  canRun.value ? ComfyQueueButton : SubscribeToRunButton
)
</script>
