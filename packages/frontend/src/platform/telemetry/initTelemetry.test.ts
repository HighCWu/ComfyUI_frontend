import { beforeEach, expect, it, vi } from 'vitest'

import { ImpactTelemetryProvider } from './providers/cloud/ImpactTelemetryProvider'

vi.mock(import('./index'))
vi.mock(import('./providers/cloud/MixpanelTelemetryProvider'))
vi.mock(import('./providers/cloud/GtmTelemetryProvider'))
vi.mock(import('./providers/cloud/ImpactTelemetryProvider'))
vi.mock(import('./providers/cloud/PostHogTelemetryProvider'))
vi.mock(import('./providers/cloud/ClickHouseTelemetryProvider'))
vi.mock(import('./providers/cloud/SyftTelemetryProvider'))
vi.mock(import('./providers/cloud/CustomerIoTelemetryProvider'))
vi.mock(import('./providers/cloud/DatadogRumTelemetryProvider'))
vi.mock(import('./providers/cloud/SentryTelemetryProvider'))

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('__DISTRIBUTION__', 'cloud')
})

it('does not register upstream telemetry providers for the prepaid product', async () => {
  vi.stubEnv('VITE_RUN_BILLING_MODE', 'prepaid')
  const { initTelemetry } = await import('./initTelemetry')
  const { setTelemetryRegistry } = await import('./index')
  await Promise.all([initTelemetry(), initTelemetry()])
  expect(ImpactTelemetryProvider).not.toHaveBeenCalled()
  expect(setTelemetryRegistry).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

it('preserves one-time upstream initialization outside the prepaid product', async () => {
  vi.stubEnv('VITE_RUN_BILLING_MODE', '')
  const { initTelemetry } = await import('./initTelemetry')
  const { setTelemetryRegistry } = await import('./index')
  await Promise.all([initTelemetry(), initTelemetry()])
  expect(ImpactTelemetryProvider).toHaveBeenCalledOnce()
  expect(setTelemetryRegistry).toHaveBeenCalledOnce()
})
