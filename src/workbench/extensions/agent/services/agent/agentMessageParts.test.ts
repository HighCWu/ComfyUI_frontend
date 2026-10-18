import { expect, it } from 'vitest'

import type { MessagePart } from './agentMessageParts'
import {
  retireAskParts,
  settleAskResolution,
  toAskResolution
} from './agentMessageParts'

const question: MessagePart = {
  type: 'runApproval',
  askId: 'ask-1',
  question: {
    kind: 'ask_user',
    ask_id: 'ask-1',
    message_id: 'message-1',
    prompt: 'Choose output',
    options: [{ id: 'png', label: 'PNG' }],
    min_selections: 1,
    max_selections: 1,
    allow_other: true
  }
}

it('maps the authoritative resolved payload including free text', () => {
  expect(
    toAskResolution({
      status: 'answered',
      selected: ['png'],
      other_text: 'Preserve alpha'
    })
  ).toEqual({
    status: 'answered',
    selected: ['png'],
    otherText: 'Preserve alpha'
  })
  expect(toAskResolution({ status: 'cancelled', selected: null })).toEqual({
    status: 'closed'
  })
})

it('keeps the most complete authoritative answer', () => {
  expect(
    settleAskResolution(
      { status: 'answered', selected: ['png'] },
      {
        status: 'answered',
        selected: ['png'],
        otherText: 'Preserve alpha'
      }
    )
  ).toEqual({
    status: 'answered',
    selected: ['png'],
    otherText: 'Preserve alpha'
  })
  expect(
    settleAskResolution(
      {
        status: 'answered',
        selected: ['png'],
        otherText: 'Preserve alpha'
      },
      { status: 'retired' }
    )
  ).toEqual({
    status: 'answered',
    selected: ['png'],
    otherText: 'Preserve alpha'
  })
})

it('keeps a resolved question read-only while dropping run and pause approvals', () => {
  const resolution = {
    status: 'answered' as const,
    selected: ['png'],
    otherText: 'Preserve alpha'
  }
  expect(retireAskParts([question], 'ask-1', resolution)).toEqual([
    { ...question, resolution }
  ])
  expect(
    retireAskParts(
      [
        { type: 'runApproval', askId: 'run-1' },
        {
          type: 'runApproval',
          askId: 'pause-1',
          paused: {
            kind: 'paused',
            ask_id: 'pause-1',
            message_id: 'message-1',
            prompt: 'Resume?',
            options: [{ id: 'resume', label: 'Resume' }],
            min_selections: 1,
            max_selections: 1,
            allow_other: false,
            context: {
              message: 'Paused',
              reason: 'step_limit',
              recheck_after_seconds: 0
            }
          }
        }
      ],
      'run-1',
      resolution
    )
  ).toHaveLength(1)
  expect(
    retireAskParts(
      [
        {
          type: 'runApproval',
          askId: 'pause-1',
          paused: {
            kind: 'paused',
            ask_id: 'pause-1',
            message_id: 'message-1',
            prompt: 'Resume?',
            options: [{ id: 'resume', label: 'Resume' }],
            min_selections: 1,
            max_selections: 1,
            allow_other: false,
            context: {
              message: 'Paused',
              reason: 'step_limit',
              recheck_after_seconds: 0
            }
          }
        }
      ],
      'pause-1',
      resolution
    )
  ).toEqual([])
})
