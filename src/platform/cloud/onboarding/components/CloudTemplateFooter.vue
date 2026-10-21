<template>
  <footer class="mt-10 flex w-full shrink-0 items-start justify-center gap-2.5">
    <a
      :href="presentation.terms"
      target="_blank"
      rel="noopener noreferrer"
      class="cursor-pointer text-sm text-primary-comfy-canvas/60 no-underline"
    >
      {{ t('auth.login.termsLink') }}
    </a>
    <a
      :href="presentation.privacy"
      target="_blank"
      rel="noopener noreferrer"
      class="cursor-pointer text-sm text-primary-comfy-canvas/60 no-underline"
    >
      {{ t('auth.login.privacyLink') }}
    </a>
    <a
      :href="presentation.support"
      class="cursor-pointer text-sm text-primary-comfy-canvas/60 no-underline"
      target="_blank"
      rel="noopener noreferrer"
    >
      {{ t('cloudFooter_needHelp') }}
    </a>
  </footer>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { getOnboardingPresentation } from '@/platform/cloud/onboarding/onboardingPresentation'

const { t } = useI18n()
const presentation = getOnboardingPresentation()
</script>
