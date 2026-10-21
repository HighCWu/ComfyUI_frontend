import { defineAsyncComponent } from 'vue'

import { isCloud } from '@/platform/distribution/types'

export default isCloud
  ? import.meta.env.VITE_RUN_BILLING_MODE === 'prepaid' ||
    window.__CONFIG__?.subscription_required
    ? defineAsyncComponent(() => import('./CloudRunButtonWrapper.vue'))
    : defineAsyncComponent(() => import('./ComfyQueueButton.vue'))
  : defineAsyncComponent(() => import('./LocalRunButtonWrapper.vue'))
