import type { components } from '@comfyorg/registry-types'
import { z } from 'zod'
import type { ZodType } from 'zod'

export type ReleaseNote = components['schemas']['ReleaseNote']

const releaseNoteSchema = z.object({
  attention: z.enum(['low', 'medium', 'high']),
  content: z.string(),
  id: z.number().int(),
  project: z.enum(['comfyui', 'comfyui_frontend', 'desktop', 'cloud']),
  published_at: z.iso.datetime(),
  version: z.string()
}) satisfies ZodType<ReleaseNote>

export const releaseNotesResponseSchema = z.array(releaseNoteSchema)
