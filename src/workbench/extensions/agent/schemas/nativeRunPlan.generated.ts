import { z } from 'zod'

export const nativeAcceptedAttachmentPolicy = {
  view: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'],
  probe: [
    '.mp4',
    '.webm',
    '.mov',
    '.m4v',
    '.avi',
    '.mkv',
    '.mp3',
    '.wav',
    '.ogg',
    '.opus',
    '.flac',
    '.m4a'
  ],
  read: [
    '.md',
    '.markdown',
    '.txt',
    '.json',
    '.csv',
    '.yaml',
    '.yml',
    '.xml',
    '.log',
    '.svg'
  ],
  reference: [
    '.glb',
    '.obj',
    '.fbx',
    '.gltf',
    '.stl',
    '.ply',
    '.spz',
    '.splat',
    '.ksplat'
  ],
  retain: ['.avif']
} as const

export const nativeRunPlanCapabilitiesSchema = z.object({
  runPlanRefreshEnabled: z.boolean()
})

export const nativeRunPlanIdentitySchema = z
  .object({
    workflowId: z.string().uuid(),
    expectedVersion: z.number().int().max(1000).gt(0),
    expectedRevision: z.string().regex(new RegExp('^[a-f0-9]{64}$')),
    expectedCandidateRevision: z.string().regex(new RegExp('^[a-f0-9]{64}$'))
  })
  .strict()

export const nativeRunPlanResultSchema = z
  .object({
    session_id: z.string().regex(new RegExp('^eds_.*')).max(128),
    expires_at: z.number().int().max(9007199254740991).gt(0),
    workflow_id: z.string().uuid(),
    version: z.number().int().max(9007199254740991).gt(0),
    revision: z.string().regex(new RegExp('^[a-f0-9]{64}$')),
    candidate_revision: z.string().regex(new RegExp('^[a-f0-9]{64}$')),
    model_review_required: z.boolean(),
    dependency_count: z.number().int().min(0).max(9007199254740991),
    execution_started: z.literal(false),
    credits_reserved: z.literal(false),
    model_downloads_started: z.literal(false),
    cloud_resources_created: z.literal(false)
  })
  .strict()

export const nativeAttachmentCapabilitiesSchema = z.object({
  attachments: z.boolean(),
  attachmentPolicy: z
    .object({
      maxFiles: z.number().int().max(9007199254740991).gt(0),
      maxFileBytes: z.number().int().max(9007199254740991).gt(0),
      maxTotalBytes: z.number().int().max(9007199254740991).gt(0),
      filenamePattern: z.string().max(256)
    })
    .strict()
})
