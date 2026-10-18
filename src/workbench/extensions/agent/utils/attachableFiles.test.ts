import { describe, expect, it } from 'vitest'

import { nativeAcceptedAttachmentPolicy } from '../schemas/nativeRunPlan.generated'
import {
  AGENT_ATTACH_ACCEPT,
  agentAttachCapability,
  agentAttachRefVerdict,
  agentAttachVerdict,
  isAgentAttachable,
  isValidAgentAttachment
} from './attachableFiles'

const acceptedExtensions = Object.values(nativeAcceptedAttachmentPolicy).flat()

function fileNamed(name: string, bytes = 'x'): File {
  return new File([bytes], name, { type: '' })
}

describe('Agent attachment policy', () => {
  it.for(acceptedExtensions)(
    'accepts backend-supported %s files',
    (extension) => {
      const name = `attachment${extension}`

      expect(isAgentAttachable(fileNamed(name))).toBe(true)
      expect(agentAttachVerdict(name)).toBe('accepted')
      expect(agentAttachCapability(name)).toBeDefined()
    }
  )

  it.for(['.tif', '.tiff', '.heic', '.heif'])(
    'rejects deliberately unsupported %s files',
    (extension) => {
      const name = `attachment${extension}`

      expect(isAgentAttachable(fileNamed(name))).toBe(false)
      expect(agentAttachVerdict(name)).toBe('rejected')
      expect(agentAttachRefVerdict(`input/${name}`)).toBe('rejected')
    }
  )

  it('keeps unknown extensionless references distinct from rejected files', () => {
    expect(agentAttachVerdict('README')).toBe('unknown')
    expect(agentAttachRefVerdict('content-addressed-reference')).toBe('unknown')
  })

  it('generates the picker accept list from the backend policy without wildcards', () => {
    const accepted = AGENT_ATTACH_ACCEPT.split(',')

    expect(new Set(accepted)).toEqual(new Set(acceptedExtensions))
    expect(accepted).toHaveLength(38)
    expect(accepted.every((value) => value.startsWith('.'))).toBe(true)
  })
})

describe('isValidAgentAttachment', () => {
  it('accepts an MP4 with an ISO base media header', async () => {
    const bytes = new Uint8Array(12)
    bytes.set([0x66, 0x74, 0x79, 0x70], 4)

    await expect(
      isValidAgentAttachment(new File([bytes], 'clip.mp4'))
    ).resolves.toBe(true)
  })

  it('rejects a video whose bytes do not match its container extension', async () => {
    await expect(
      isValidAgentAttachment(fileNamed('clip.mp4', 'not a video'))
    ).resolves.toBe(false)
  })

  it('does not require a container signature for non-video attachments', () => {
    expect(isValidAgentAttachment(fileNamed('workflow.json'))).toBe(true)
  })
})
