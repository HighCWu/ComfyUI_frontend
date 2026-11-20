import { expect, it, onTestFinished, vi } from 'vitest'

import { api } from '@/scripts/api'

import { createNativeRunPlanClient } from './nativeRunPlanClient'

vi.mock(import('@/platform/telemetry/reportError'))

const workflowId = '12345678-1234-4234-8234-123456789abc'
const identity = {
  workflowId,
  expectedVersion: 2,
  expectedRevision: 'a'.repeat(64),
  expectedCandidateRevision: 'b'.repeat(64)
}
const result = {
  session_id: 'eds_12345678-1234-4234-8234-123456789def',
  expires_at: 9007199254740991,
  workflow_id: workflowId,
  version: 2,
  revision: 'a'.repeat(64),
  candidate_revision: 'b'.repeat(64),
  model_review_required: false,
  dependency_count: 0,
  execution_started: false,
  credits_reserved: false,
  model_downloads_started: false,
  cloud_resources_created: false
}

it('binds the capability probe to the active editor session', async () => {
  const previousName = window.name
  window.name = 'eds_capability-session'
  onTestFinished(() => {
    window.name = previousName
  })
  vi.mocked(global.fetch).mockResolvedValueOnce(
    Response.json({ runPlanRefreshEnabled: true })
  )

  expect(
    await createNativeRunPlanClient().enabled(new AbortController().signal)
  ).toBe(true)
  expect(vi.mocked(global.fetch).mock.calls[0]?.[0]).toBe(
    '/api/agent/capabilities?client_id=eds_capability-session'
  )
})

it('binds both run-plan requests to the active editor session', async () => {
  const previousName = window.name
  window.name = 'eds_transport-session'
  onTestFinished(() => {
    window.name = previousName
  })
  vi.mocked(global.fetch)
    .mockResolvedValueOnce(Response.json(identity))
    .mockResolvedValueOnce(Response.json(result))

  await createNativeRunPlanClient().update(
    workflowId,
    { nodes: [], links: [] },
    () => true,
    new AbortController().signal
  )

  expect(
    vi.mocked(global.fetch).mock.calls.map(([request]) => String(request))
  ).toEqual([
    '/api/agent/run-plan/preview?client_id=eds_transport-session',
    '/api/agent/run-plan/refresh?client_id=eds_transport-session'
  ])
  expect(api.apiURL('/agent/run-plan/preview?client_id=eds_stale')).toBe(
    '/api/agent/run-plan/preview?client_id=eds_transport-session'
  )
})
