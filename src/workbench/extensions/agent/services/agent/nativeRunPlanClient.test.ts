import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { api } from '@/scripts/api'

import { createNativeRunPlanClient } from './nativeRunPlanClient'

vi.mock(import('@/scripts/api'))
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

function context() {
  const previous = window.name
  window.name = 'eds_original'
  onTestFinished(() => {
    window.name = previous
  })
  return new AbortController()
}

describe('native run-plan client', () => {
  it('uses exact server identity for an explicit update without adopting a session or executing', async () => {
    const controller = context()
    vi.mocked(api.fetchApi)
      .mockResolvedValueOnce(Response.json(identity))
      .mockResolvedValueOnce(Response.json(result))
    const draft = { nodes: [], links: [] }
    expect(
      await createNativeRunPlanClient().update(
        workflowId,
        draft,
        () => true,
        controller.signal
      )
    ).toEqual(result)
    expect(api.fetchApi).toHaveBeenNthCalledWith(
      1,
      '/agent/run-plan/preview',
      expect.objectContaining({
        body: JSON.stringify({ workflowId, draft: { content: draft } })
      })
    )
    expect(api.fetchApi).toHaveBeenNthCalledWith(
      2,
      '/agent/run-plan/refresh',
      expect.objectContaining({ body: JSON.stringify(identity) })
    )
    expect(window.name).toBe('eds_original')
  })

  it.for([
    {},
    { runPlanRefreshEnabled: false },
    { runPlanRefreshEnabled: true, conversation: false }
  ])(
    'renders the server capability, not an inferred permission: %j',
    async (body) => {
      const controller = context()
      vi.mocked(api.fetchApi).mockResolvedValueOnce(Response.json(body))
      expect(await createNativeRunPlanClient().enabled(controller.signal)).toBe(
        'runPlanRefreshEnabled' in body && body.runPlanRefreshEnabled
      )
    }
  )

  it('refuses a changed URL context between preview and update', async () => {
    const controller = context()
    vi.mocked(api.fetchApi).mockImplementationOnce(async () => {
      window.name = 'eds_other'
      return Response.json(identity)
    })
    expect(
      await createNativeRunPlanClient().update(
        workflowId,
        {},
        () => true,
        controller.signal
      )
    ).toBeUndefined()
    expect(api.fetchApi).toHaveBeenCalledOnce()
  })

  it.for([
    { ...result, credits_reserved: true },
    { ...result, candidate_revision: 'c'.repeat(64) },
    { ...result, expires_at: 1 }
  ])(
    'does not accept charged, mismatched or expired updates: %j',
    async (body) => {
      const controller = context()
      vi.mocked(api.fetchApi)
        .mockResolvedValueOnce(Response.json(identity))
        .mockResolvedValueOnce(Response.json(body))
      expect(
        await createNativeRunPlanClient().update(
          workflowId,
          {},
          () => true,
          controller.signal
        )
      ).toBeUndefined()
      expect(window.name).toBe('eds_original')
    }
  )

  it('does not update an edited draft after its preview finishes', async () => {
    const controller = context()
    let current = true
    vi.mocked(api.fetchApi).mockImplementationOnce(async () => {
      current = false
      return Response.json(identity)
    })
    expect(
      await createNativeRunPlanClient().update(
        workflowId,
        {},
        () => current,
        controller.signal
      )
    ).toBeUndefined()
    expect(api.fetchApi).toHaveBeenCalledOnce()
  })
})
