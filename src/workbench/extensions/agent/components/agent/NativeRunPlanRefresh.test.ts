import { render, screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { expect, it, onTestFinished, vi } from 'vitest'

import { i18n } from '@/i18n'
import { api } from '@/scripts/api'

import NativeRunPlanRefresh from './NativeRunPlanRefresh.vue'

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

function fixture(disabled = false) {
  const name = window.name
  const stored = sessionStorage.getItem('clientId')
  window.name = 'eds_original'
  onTestFinished(() => {
    window.name = name
    if (stored === null) sessionStorage.removeItem('clientId')
    else sessionStorage.setItem('clientId', stored)
  })
  const draft = { nodes: [], links: [] }
  return render(NativeRunPlanRefresh, {
    props: {
      workflowId,
      disabled,
      prepareDraft: async () => draft,
      readDraft: () => draft
    },
    global: { plugins: [i18n] }
  })
}

it('requires the user click before updating and adopting the exact new session', async () => {
  const previousUrl = window.location.href
  window.history.replaceState(
    {},
    '',
    '/comfy/?client_id=eds_original&share=shr_one'
  )
  onTestFinished(() => window.history.replaceState({}, '', previousUrl))
  const reload = vi
    .spyOn(window.location, 'reload')
    .mockImplementation(() => {})
  vi.mocked(api.fetchApi)
    .mockResolvedValueOnce(Response.json({ runPlanRefreshEnabled: true }))
    .mockResolvedValueOnce(Response.json(identity))
    .mockResolvedValueOnce(Response.json(result))
  fixture()
  const button = await screen.findByRole('button', {
    name: 'Update plan and reload'
  })
  expect(api.fetchApi).toHaveBeenCalledOnce()
  expect(window.name).toBe('eds_original')
  await userEvent.click(button)
  await waitFor(() => expect(reload).toHaveBeenCalledOnce())
  expect(window.name).toBe(result.session_id)
  expect(sessionStorage.getItem('clientId')).toBe(result.session_id)
  expect(window.location.search).toBe(
    '?client_id=eds_12345678-1234-4234-8234-123456789def&share=shr_one'
  )
})

it('does not replace the current session when model review is required', async () => {
  const reload = vi
    .spyOn(window.location, 'reload')
    .mockImplementation(() => {})
  vi.mocked(api.fetchApi)
    .mockResolvedValueOnce(Response.json({ runPlanRefreshEnabled: true }))
    .mockResolvedValueOnce(Response.json(identity))
    .mockResolvedValueOnce(
      Response.json({ ...result, model_review_required: true })
    )
  fixture()
  await userEvent.click(
    await screen.findByRole('button', { name: 'Update plan and reload' })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Some model dependencies need review'
  )
  expect(reload).not.toHaveBeenCalled()
  expect(window.name).toBe('eds_original')
})

it('keeps updates disabled during another active operation', async () => {
  vi.mocked(api.fetchApi).mockResolvedValueOnce(
    Response.json({ runPlanRefreshEnabled: true })
  )
  fixture(true)
  const button = await screen.findByRole('button', {
    name: 'Update plan and reload'
  })
  expect(button).toBeDisabled()
  await userEvent.click(button)
  expect(api.fetchApi).toHaveBeenCalledOnce()
})

it('does not adopt a returned session when the editor became busy during the request', async () => {
  const reload = vi
    .spyOn(window.location, 'reload')
    .mockImplementation(() => {})
  const response = Promise.withResolvers<Response>()
  vi.mocked(api.fetchApi)
    .mockResolvedValueOnce(Response.json({ runPlanRefreshEnabled: true }))
    .mockResolvedValueOnce(Response.json(identity))
    .mockReturnValueOnce(response.promise)
  const { rerender } = fixture()
  await userEvent.click(
    await screen.findByRole('button', { name: 'Update plan and reload' })
  )
  await waitFor(() => expect(api.fetchApi).toHaveBeenCalledTimes(3))
  await rerender({ disabled: true })
  response.resolve(Response.json(result))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The plan could not be updated'
  )
  expect(reload).not.toHaveBeenCalled()
  expect(window.name).toBe('eds_original')
})
