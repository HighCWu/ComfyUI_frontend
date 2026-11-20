import type { AgentPendingPaused } from '@comfyorg/ingest-types'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'

import { i18n } from '@/i18n'

import { agentPausedSchema } from '../../../services/agent/agentPaused'
import RunApprovalCard from './RunApprovalCard.vue'

const paused: AgentPendingPaused = {
  kind: 'paused',
  ask_id: 'pause-1',
  message_id: 'turn',
  prompt: 'Reply paused',
  options: [{ id: 'resume', label: 'Resume' }],
  min_selections: 1,
  max_selections: 1,
  allow_other: false,
  context: {
    reason: 'step_limit',
    message: '<img src=x onerror=alert(1)>',
    recheck_after_seconds: 0
  }
}

it('renders a pause through the original card host without Run consent or impressions', async () => {
  const { emitted } = render(RunApprovalCard, {
    props: { part: { type: 'runApproval', askId: paused.ask_id, paused } },
    global: { plugins: [i18n] }
  })
  expect(screen.getByRole('region', { name: 'Reply paused' })).toBeVisible()
  expect(screen.getByText(paused.context.message)).toBeVisible()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument()
  expect(emitted().shown).toBeUndefined()
  await userEvent.click(screen.getByRole('button', { name: 'Resume' }))
  expect(emitted().answer).toEqual([['pause-1', { selected: ['resume'] }]])
})

it('disables Resume while its answer is in flight', async () => {
  const { emitted } = render(RunApprovalCard, {
    props: {
      part: { type: 'runApproval', askId: paused.ask_id, paused },
      answering: true
    },
    global: { plugins: [i18n] }
  })
  const button = screen.getByRole('button', { name: 'Resume' })
  expect(button).toBeDisabled()
  await userEvent.click(button)
  expect(emitted().answer).toBeUndefined()
})

it('accepts only the supported immediate budget-pause contract', () => {
  expect(agentPausedSchema.safeParse(paused).success).toBe(true)
  for (const invalid of [
    { ...paused, allow_other: true },
    { ...paused, options: [{ id: 'run', label: 'Run' }] },
    { ...paused, max_selections: 2 },
    { ...paused, context: { ...paused.context, reason: 'no_funds' } },
    { ...paused, context: { ...paused.context, recheck_after_seconds: 30 } }
  ]) {
    expect(agentPausedSchema.safeParse(invalid).success).toBe(false)
  }
})
