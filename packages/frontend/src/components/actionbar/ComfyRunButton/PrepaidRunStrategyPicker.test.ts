import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '@testing-library/vue'
import { expect, it, onTestFinished, vi } from 'vitest'
import { createI18n } from 'vue-i18n'

import { api } from '@/scripts/api'
import { i18n } from '@/i18n'
import en from '@/locales/en/main.json'
import zh from '@/locales/zh/main.json'
import PrepaidRunStrategyPicker from './PrepaidRunStrategyPicker.vue'

const strategies = {
  default_strategy_id: 'rtx4090',
  execution_started: false,
  credits_reserved: false,
  strategies: [
    {
      id: 'rtx4090',
      name: 'RTX 4090',
      memory_gb: 24,
      provider_hourly_milliusd_estimate: 890,
      coverage_ceiling_bps: 2000,
      rate_basis: 'configured_estimate',
      settlement_basis: 'actual_provider_usage'
    }
  ]
}

it('opens on hover while direct Run stays immediate and never requests a quote', async () => {
  const fetcher = vi
    .spyOn(api, 'fetchApi')
    .mockResolvedValue(Response.json(strategies))
  const run = vi.fn()
  render(
    {
      components: { PrepaidRunStrategyPicker },
      setup: () => ({ run }),
      template:
        '<PrepaidRunStrategyPicker enabled><button @click="run">Run</button></PrepaidRunStrategyPicker>'
    },
    { global: { plugins: [i18n] } }
  )
  const user = userEvent.setup()
  const button = screen.getByRole('button', { name: /^Run$/ })
  await user.hover(button)
  expect(
    await screen.findByRole('radio', { name: 'RTX 4090' })
  ).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByText(/0.890/)).toBeVisible()
  await user.click(button)
  expect(run).toHaveBeenCalledOnce()
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    '/run-strategies',
    expect.any(Object)
  )
})

it('supports explicit keyboard opening and Escape without running a task', async () => {
  vi.spyOn(api, 'fetchApi').mockResolvedValue(Response.json(strategies))
  render(
    {
      components: { PrepaidRunStrategyPicker },
      template: '<PrepaidRunStrategyPicker enabled />'
    },
    { global: { plugins: [i18n] } }
  )
  const user = userEvent.setup()
  await user.tab()
  await user.keyboard('{Enter}')
  expect(await screen.findByRole('radio', { name: 'RTX 4090' })).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('radio')).toBeNull())
  expect(screen.getByRole('button', { name: 'Run strategy' })).toHaveFocus()
})

it('dismisses from the focused trigger before native Escape bindings and preserves them while closed', async () => {
  vi.spyOn(api, 'fetchApi').mockResolvedValue(Response.json(strategies))
  const nativeEscape = vi.fn((event: KeyboardEvent) => event.preventDefault())
  window.addEventListener('keydown', nativeEscape)
  onTestFinished(() => window.removeEventListener('keydown', nativeEscape))
  render(PrepaidRunStrategyPicker, {
    props: { enabled: true },
    global: { plugins: [i18n] }
  })
  const user = userEvent.setup()
  const trigger = screen.getByRole('button', { name: 'Run strategy' })
  await user.click(trigger)
  expect(await screen.findByRole('radio', { name: 'RTX 4090' })).toBeVisible()
  expect(trigger).toHaveFocus()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(trigger).toHaveFocus()
  expect(nativeEscape).not.toHaveBeenCalled()
  await user.keyboard('{Escape}')
  expect(nativeEscape).toHaveBeenCalledOnce()
})

it('keeps the Run control available when the read-only reference fails', async () => {
  vi.spyOn(api, 'fetchApi').mockResolvedValue(
    new Response(null, { status: 503 })
  )
  const run = vi.fn()
  render(
    {
      components: { PrepaidRunStrategyPicker },
      setup: () => ({ run }),
      template:
        '<PrepaidRunStrategyPicker enabled><button @click="run">Run</button></PrepaidRunStrategyPicker>'
    },
    { global: { plugins: [i18n] } }
  )
  const user = userEvent.setup()
  await user.hover(screen.getByRole('button', { name: 'Run' }))
  expect(await screen.findByRole('status')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Run' }))
  expect(run).toHaveBeenCalledOnce()
})

it('opens with one touch instead of opening on pointer entry and immediately closing again', async () => {
  vi.spyOn(api, 'fetchApi').mockResolvedValue(Response.json(strategies))
  render(
    {
      components: { PrepaidRunStrategyPicker },
      template: '<PrepaidRunStrategyPicker enabled />'
    },
    { global: { plugins: [i18n] } }
  )
  const user = userEvent.setup()
  await user.pointer({
    keys: '[TouchA]',
    target: screen.getByRole('button', { name: 'Run strategy' })
  })
  expect(await screen.findByRole('radio', { name: 'RTX 4090' })).toBeVisible()
})

it('pins a hovered panel on icon click and closes it on the next click', async () => {
  vi.spyOn(api, 'fetchApi').mockResolvedValue(Response.json(strategies))
  render(PrepaidRunStrategyPicker, {
    props: { enabled: true },
    global: { plugins: [i18n] }
  })
  const user = userEvent.setup()
  const trigger = screen.getByRole('button', { name: 'Run strategy' })
  await user.hover(trigger)
  expect(await screen.findByRole('radio', { name: 'RTX 4090' })).toBeVisible()
  await user.click(trigger)
  expect(screen.getByRole('radio', { name: 'RTX 4090' })).toBeVisible()
  await user.unhover(trigger)
  expect(screen.getByRole('radio', { name: 'RTX 4090' })).toBeVisible()
  await user.click(trigger)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('updates an open panel when the shared locale changes and falls back to English', async () => {
  const fetcher = vi
    .spyOn(api, 'fetchApi')
    .mockResolvedValue(Response.json(strategies))
  const locale = createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, zh, ja: {} }
  })
  render(PrepaidRunStrategyPicker, {
    props: { enabled: true },
    global: { plugins: [locale] }
  })
  const user = userEvent.setup()
  await user.hover(screen.getByRole('button', { name: 'Run strategy' }))
  expect(
    await screen.findByText('Provider reference: US$0.890/hour')
  ).toBeVisible()
  locale.global.locale.value = 'zh'
  expect(await screen.findByRole('dialog', { name: '运行策略' })).toBeVisible()
  expect(screen.getByText('供应商参考价：US$0.890/小时')).toBeVisible()
  expect(screen.getByRole('link', { name: '查看余额与计费明细' })).toBeVisible()
  locale.global.locale.value = 'ja'
  expect(
    await screen.findByRole('dialog', { name: 'Run strategy' })
  ).toBeVisible()
  expect(screen.getByText('Provider reference: US$0.890/hour')).toBeVisible()
  expect(fetcher).toHaveBeenCalledOnce()
})
