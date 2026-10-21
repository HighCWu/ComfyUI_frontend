<template>
  <div
    class="mt-10 shrink-0 text-center text-sm/relaxed text-primary-warm-gray"
  >
    <p class="my-0">
      {{ t('auth.login.termsText') }}
      <br />
      <a
        :href="presentation.terms"
        target="_blank"
        rel="noopener noreferrer"
        class="text-primary-comfy-canvas underline"
      >
        {{ t('auth.login.termsLink') }}
      </a>
      {{ t('auth.login.andText') }}
      <a
        :href="presentation.privacy"
        target="_blank"
        rel="noopener noreferrer"
        class="text-primary-comfy-canvas underline"
      >
        {{ t('auth.login.privacyLink') }} </a
      >.
    </p>
    <p class="my-4 text-xs/relaxed">
      {{ t('cloudWaitlist_questionsText') }}
      <a
        :href="presentation.support"
        target="_blank"
        rel="noopener noreferrer"
        class="text-primary-comfy-canvas underline"
      >
        {{ t('cloudWaitlist_contactLink') }} </a
      >.
    </p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { getOnboardingPresentation } from '@/platform/cloud/onboarding/onboardingPresentation'

const { t } = useI18n()
const presentation = getOnboardingPresentation()
</script>
