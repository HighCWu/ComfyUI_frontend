import { describe, expect, it } from 'vitest'

import {
  attachmentBoundsMessage,
  refusedAttachmentsMessage
} from './attachmentMessages'

describe('refusedAttachmentsMessage', () => {
  it.for([
    {
      names: ['doc.pdf'],
      count: 1,
      expected: 'doc.pdf is not a file type the agent accepts'
    },
    {
      names: ['doc.pdf', 'clip.mp4'],
      count: 2,
      expected: 'doc.pdf, clip.mp4 are not file types the agent accepts'
    },
    {
      names: ['a.pdf', 'b.pdf', 'c.pdf'],
      count: 40,
      expected:
        'a.pdf, b.pdf, c.pdf and 37 more are not file types the agent accepts'
    },
    {
      names: [],
      count: 12,
      expected: '12 are not file types the agent accepts'
    }
  ])(
    'formats a bounded refusal list: $expected',
    ({ names, count, expected }) => {
      expect(refusedAttachmentsMessage(names, count)).toBe(expected)
    }
  )
})

describe('attachmentBoundsMessage', () => {
  it('describes the server attachment-count limit', () => {
    expect(
      attachmentBoundsMessage({
        limits: { maxItemLength: 256, maxItems: 25 },
        overlongRef: '',
        receivedCount: 26
      })
    ).toBe('Only 25 files can be attached to one message')
  })

  it('describes an overlong attachment reference without echoing it', () => {
    expect(
      attachmentBoundsMessage({
        limits: { maxItemLength: 256, maxItems: 25 },
        overlongRef: 'private-reference',
        receivedCount: 1
      })
    ).toBe('An attachment reference cannot exceed 256 characters')
  })
})
