import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '@testing-library/vue'
import { PopoverTrigger } from 'reka-ui'
import { expect, it, vi } from 'vitest'

import { api } from '@/scripts/api'
import { i18n } from '@/i18n'
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
      components: { PrepaidRunStrategyPicker, PopoverTrigger },
      setup: () => ({ run }),
      template:
        '<PrepaidRunStrategyPicker enabled><template #default="{ selectedName }"><button @click="run">Run {{ selectedName }}</button><PopoverTrigger>Choose strategy</PopoverTrigger></template></PrepaidRunStrategyPicker>'
    },
    { global: { plugins: [i18n] } }
  )
  const user = userEvent.setup()
  const button = await screen.findByRole('button', { name: 'Run RTX 4090' })
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
      components: { PrepaidRunStrategyPicker, PopoverTrigger },
      template:
        '<PrepaidRunStrategyPicker enabled><PopoverTrigger>Choose strategy</PopoverTrigger></PrepaidRunStrategyPicker>'
    },
    { global: { plugins: [i18n] } }
  )
  const user = userEvent.setup()
  await user.tab()
  await user.keyboard('{Enter}')
  expect(await screen.findByRole('radio', { name: 'RTX 4090' })).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('radio')).toBeNull())
  expect(screen.getByRole('button', { name: 'Choose strategy' })).toHaveFocus()
})

it('keeps the Run control available when the read-only reference fails', async () => {
  vi.spyOn(api, 'fetchApi').mockResolvedValue(
    new Response(null, { status: 503 })
  )
  const run = vi.fn()
  render(
    {
      components: { PrepaidRunStrategyPicker, PopoverTrigger },
      setup: () => ({ run }),
      template:
        '<PrepaidRunStrategyPicker enabled><button @click="run">Run</button><PopoverTrigger>Choose strategy</PopoverTrigger></PrepaidRunStrategyPicker>'
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
      components: { PrepaidRunStrategyPicker, PopoverTrigger },
      template:
        '<PrepaidRunStrategyPicker enabled><PopoverTrigger>Choose strategy</PopoverTrigger></PrepaidRunStrategyPicker>'
    },
    { global: { plugins: [i18n] } }
  )
  const user = userEvent.setup()
  await user.pointer({
    keys: '[TouchA]',
    target: screen.getByRole('button', { name: 'Choose strategy' })
  })
  expect(await screen.findByRole('radio', { name: 'RTX 4090' })).toBeVisible()
})
