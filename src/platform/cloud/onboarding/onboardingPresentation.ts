export function getOnboardingPresentation() {
  const prepaid = import.meta.env.VITE_RUN_BILLING_MODE === 'prepaid'
  return {
    wordmark: prepaid ? 'Laimon' : null,
    terms: prepaid ? '/terms' : 'https://comfy.org/terms-of-service/',
    privacy: prepaid ? '/privacy' : 'https://comfy.org/privacy-policy/',
    support: prepaid ? '/support' : 'https://support.comfy.org',
    surveyTitleKey: prepaid
      ? 'laimonOnboarding.surveyTitle'
      : 'cloudOnboarding.survey.title',
    surveyIntroKey: prepaid
      ? 'laimonOnboarding.surveyIntro'
      : 'cloudOnboarding.survey.intro'
  }
}
