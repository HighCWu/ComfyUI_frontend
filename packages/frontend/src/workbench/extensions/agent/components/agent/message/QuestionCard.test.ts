import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import type { AgentPendingAskUser } from '@comfyorg/ingest-types'
import QuestionCard from './QuestionCard.vue'
import { i18n } from '@/i18n'

const question: AgentPendingAskUser = {
  kind: 'ask_user',
  ask_id: 'ask-1',
  message_id: 'message-1',
  prompt: 'Choose output formats',
  options: [
    { id: 'png', label: 'PNG' },
    { id: 'webp', label: 'WebP', description: 'Smaller file' },
    { id: 'jpg', label: 'JPEG' }
  ],
  min_selections: 1,
  max_selections: 2,
  allow_other: true
}

it('sends selected server option ids and trimmed free text without offering Run', async () => {
  const { emitted } = render(QuestionCard, {
    props: { question },
    global: { plugins: [i18n] }
  })
  expect(screen.getByRole('button', { name: 'Send answer' })).toBeDisabled()
  await userEvent.click(screen.getByRole('checkbox', { name: 'PNG' }))
  await userEvent.click(screen.getByRole('checkbox', { name: /WebP/ }))
  expect(screen.getByRole('checkbox', { name: 'JPEG' })).toBeDisabled()
  await userEvent.click(screen.getByRole('checkbox', { name: /WebP/ }))
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Your answer' }),
    '  Preserve alpha  '
  )
  await userEvent.click(screen.getByRole('button', { name: 'Send answer' }))
  expect(emitted().answer).toEqual([
    ['ask-1', { selected: ['png'], other_text: 'Preserve alpha' }]
  ])
  expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument()
})

it('supports a free-text-only answer and blocks interaction while the answer is in flight', async () => {
  const { emitted, rerender } = render(QuestionCard, {
    props: { question },
    global: { plugins: [i18n] }
  })
  await userEvent.type(screen.getByRole('textbox'), 'Another format')
  await userEvent.click(screen.getByRole('button', { name: 'Send answer' }))
  expect(emitted().answer).toEqual([
    ['ask-1', { selected: [], other_text: 'Another format' }]
  ])
  await rerender({ question, answering: true })
  expect(screen.getByRole('button', { name: 'Send answer' })).toBeDisabled()
  expect(screen.getByRole('checkbox', { name: 'PNG' })).toBeDisabled()
})

it('replaces the prior choice for a single-selection question', async () => {
  const { emitted } = render(QuestionCard, {
    props: { question: { ...question, max_selections: 1, allow_other: false } },
    global: { plugins: [i18n] }
  })
  await userEvent.click(screen.getByRole('checkbox', { name: 'PNG' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'JPEG' }))
  await userEvent.click(screen.getByRole('button', { name: 'Send answer' }))
  expect(emitted().answer).toEqual([['ask-1', { selected: ['jpg'] }]])
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

it('shows the committed answer read-only instead of rebuilding the form', () => {
  render(QuestionCard, {
    props: {
      question,
      resolution: {
        status: 'answered',
        selected: ['png'],
        otherText: 'Preserve alpha'
      }
    },
    global: { plugins: [i18n] }
  })

  expect(screen.getByText('Choose output formats')).toBeVisible()
  expect(screen.getByText('Answer submitted')).toBeVisible()
  expect(screen.getByText('PNG')).toBeVisible()
  expect(screen.getByText('Other: Preserve alpha')).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
