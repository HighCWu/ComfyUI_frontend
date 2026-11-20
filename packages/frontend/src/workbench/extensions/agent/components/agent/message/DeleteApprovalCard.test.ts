import type { AgentPendingDeleteApproval } from '@comfyorg/ingest-types'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { i18n } from '@/i18n'
import DeleteApprovalCard from './DeleteApprovalCard.vue'
import { agentDeletionSchema } from '../../../services/agent/agentDeletion'

const approval: AgentPendingDeleteApproval = {
  kind: 'delete_approval',
  ask_id: 'delete-1',
  message_id: 'turn',
  prompt: 'Delete the listed nodes and their connected links?',
  options: [
    { id: 'delete', label: 'Delete' },
    { id: 'keep', label: 'Keep' }
  ],
  min_selections: 1,
  max_selections: 1,
  allow_other: false,
  context: {
    action: 'delete_nodes',
    nodes: [
      { id: '1', title: '<img src=x onerror=alert(1)>', type: 'KSampler' }
    ]
  }
}

it.for(['keep', 'delete'] as const)(
  'forwards only the explicit %s decision and renders node labels as text',
  async (choice) => {
    const { emitted } = render(DeleteApprovalCard, {
      props: { approval },
      global: { plugins: [i18n] }
    })
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', {
        name: choice === 'keep' ? 'Keep' : 'Delete'
      })
    )
    expect(emitted().answer).toEqual([['delete-1', { selected: [choice] }]])
    expect(
      screen.queryByRole('button', { name: 'Run' })
    ).not.toBeInTheDocument()
  }
)

it('disables both decisions while the answer is in flight', () => {
  render(DeleteApprovalCard, {
    props: { approval, answering: true },
    global: { plugins: [i18n] }
  })
  expect(screen.getByRole('button', { name: 'Keep' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
})

it('keeps the committed decision visible without actionable buttons', () => {
  render(DeleteApprovalCard, {
    props: {
      approval,
      resolution: { status: 'answered', selected: ['keep'] }
    },
    global: { plugins: [i18n] }
  })

  expect(screen.getByText('Answer submitted')).toBeVisible()
  expect(screen.getByText('Keep')).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('refuses forged deletion options, free-text approval and duplicated target identities', () => {
  expect(agentDeletionSchema.safeParse(approval).success).toBe(true)
  expect(
    agentDeletionSchema.safeParse({ ...approval, allow_other: true }).success
  ).toBe(false)
  expect(
    agentDeletionSchema.safeParse({
      ...approval,
      options: [
        { id: 'run', label: 'Run' },
        { id: 'keep', label: 'Keep' }
      ]
    }).success
  ).toBe(false)
  expect(
    agentDeletionSchema.safeParse({
      ...approval,
      context: { action: 'delete_nodes', nodes: [{ id: '1' }, { id: '1' }] }
    }).success
  ).toBe(false)
})
