import userEvent from '@testing-library/user-event'
import { render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import type { BalanceInfo } from '@/composables/billing/types'
import { mockBillingContext } from '@/utils/__tests__/mockBillingContext'

import CreditsPanel from './CreditsPanel.vue'

vi.mock(import('@/composables/billing/useBillingContext'))

const refreshActivity = vi.hoisted(() => vi.fn())
vi.mock<unknown>(import('./UsageLogsTable.vue'), async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      setup(_props, { expose }) {
        expose({ refresh: refreshActivity })
        return () => h('div', { 'data-testid': 'usage-logs-table' })
      }
    })
  }
})

vi.mock(
  import('@/platform/cloud/subscription/components/CreditsTile.vue'),
  () => ({
    default: defineComponent({ setup: () => () => h('div') })
  })
)

vi.mock(import('@/platform/telemetry'))

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      credits: {
        credits: 'Credits',
        workspaceCredits: 'Balance',
        activity: 'Activity',
        invoiceHistory: 'Invoice History',
        faqs: 'FAQs',
        messageSupport: 'Message Support'
      },
      subscription: {
        manageBilling: 'Manage billing',
        partnerNodesCredits: 'Partner Nodes Credits'
      }
    }
  }
})

function makeBalance(amountMicros: number): BalanceInfo {
  return {
    amountMicros,
    currency: 'usd',
    effectiveBalanceMicros: amountMicros,
    prepaidBalanceMicros: 0,
    cloudCreditBalanceMicros: 0
  }
}

describe('CreditsPanel', () => {
  function renderComponent() {
    return render(CreditsPanel, {
      global: { plugins: [i18n], stubs: { Divider: true } }
    })
  }

  it('opens the billing portal for the active billing rail', async () => {
    vi.stubEnv('VITE_RUN_BILLING_MODE', 'subscription')
    const billing = mockBillingContext()
    const user = userEvent.setup()
    renderComponent()

    await user.click(screen.getByRole('button', { name: /Invoice History/ }))

    expect(billing.manageSubscription).toHaveBeenCalledOnce()
  })

  it('opens the Laimon prepaid portal without invoking subscription management', async () => {
    vi.stubEnv('VITE_RUN_BILLING_MODE', 'prepaid')
    const billing = mockBillingContext()
    const navigate = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => {})
    render(CreditsPanel, {
      props: { embedded: true },
      global: { plugins: [i18n], stubs: { Divider: true } }
    })

    await userEvent.click(
      screen.getByRole('button', { name: /Manage billing/ })
    )

    expect(navigate).toHaveBeenCalledExactlyOnceWith('/billing/')
    expect(billing.manageSubscription).not.toHaveBeenCalled()
  })

  it('refreshes activity on a balance change but not on first hydration', async () => {
    const billing = mockBillingContext()
    const balance = ref<BalanceInfo | null>(null)
    billing.balance = computed(() => balance.value)
    renderComponent()

    balance.value = makeBalance(5000)
    await nextTick()
    expect(refreshActivity).not.toHaveBeenCalled()

    balance.value = makeBalance(9000)
    await nextTick()
    expect(refreshActivity).toHaveBeenCalledOnce()
  })
})
