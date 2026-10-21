import { render, screen } from '@testing-library/vue'
import { expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import en from '@/locales/en/main.json'
import zh from '@/locales/zh/main.json'

import CloudTemplate from './components/CloudTemplate.vue'

async function renderOnboarding(showTermsNotice = false, locale = 'en') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: CloudTemplate,
        meta: { hideHero: true, showTermsNotice }
      }
    ]
  })
  await router.push('/')
  await router.isReady()
  return render(CloudTemplate, {
    slots: { default: 'Onboarding content' },
    global: {
      plugins: [
        router,
        createI18n({ legacy: false, locale, messages: { en, zh } })
      ]
    }
  })
}

it.for([
  {
    mode: 'prepaid',
    wordmark: 'Laimon',
    links: ['/terms', '/privacy', '/support']
  },
  {
    mode: 'subscription',
    wordmark: null,
    links: [
      'https://comfy.org/terms-of-service/',
      'https://comfy.org/privacy-policy/',
      'https://support.comfy.org'
    ]
  }
])(
  'uses the correct brand and policy destinations in $mode mode',
  async ({ mode, wordmark, links }) => {
    vi.stubEnv('VITE_RUN_BILLING_MODE', mode)
    await renderOnboarding()
    expect(screen.queryByText('Laimon')?.textContent ?? null).toBe(wordmark)
    expect(screen.queryByRole('img', { name: 'ComfyOrg Logo' }) !== null).toBe(
      wordmark === null
    )
    expect(
      screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    ).toEqual(links)
    expect(screen.getByText('Onboarding content')).toBeVisible()
  }
)

it('uses the same first-party destinations in the terms notice', async () => {
  vi.stubEnv('VITE_RUN_BILLING_MODE', 'prepaid')
  await renderOnboarding(true)
  expect(
    screen.getAllByRole('link').map((link) => link.getAttribute('href'))
  ).toEqual(['/terms', '/privacy', '/support'])
})

it('keeps Chinese policy labels with first-party destinations', async () => {
  vi.stubEnv('VITE_RUN_BILLING_MODE', 'prepaid')
  await renderOnboarding(false, 'zh')
  expect(
    screen.getByRole('link', { name: zh.auth.login.termsLink })
  ).toHaveAttribute('href', '/terms')
  expect(
    screen.getByRole('link', { name: zh.auth.login.privacyLink })
  ).toHaveAttribute('href', '/privacy')
})
