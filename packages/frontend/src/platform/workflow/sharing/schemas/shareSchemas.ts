import {
  zGetPublishedWorkflowResponse,
  zGetUserdataFilePublishResponse,
  zHubProfile
} from '@comfyorg/ingest-types/zod'
import { z } from 'zod'

const zComfyHubProfile = zHubProfile
  .pick({ username: true, description: true })
  .extend({
    name: zHubProfile.shape.display_name,
    coverImageUrl: z.string().nullish(),
    profilePictureUrl: zHubProfile.shape.avatar_url.nullish()
  })

export type ComfyHubProfile = z.infer<typeof zComfyHubProfile>

export const zPublishRecordResponse = zGetUserdataFilePublishResponse

/**
 * Strips path separators and control characters from a workflow name to prevent
 * path traversal when the name is later used as part of a file path.
 */
function sanitizeWorkflowName(name: string): string {
  return name
    .replaceAll(/[/\\:]/g, '_')
    .slice(0, 200)
    .trim()
}

export const zSharedWorkflowResponse = zGetPublishedWorkflowResponse.extend({
  name: zGetPublishedWorkflowResponse.shape.name.transform(sanitizeWorkflowName)
})

export const zHubProfileResponse = z.preprocess((data) => {
  if (!data || typeof data !== 'object') return data
  const d = data as Record<string, unknown>
  return {
    username: d.username,
    name: d.name ?? d.display_name,
    description: d.description,
    coverImageUrl: d.coverImageUrl ?? d.cover_image_url,
    profilePictureUrl:
      d.profilePictureUrl ?? d.profile_picture_url ?? d.avatar_url
  }
}, zComfyHubProfile)

export const zHubAssetUploadUrlResponse = z
  .object({
    upload_url: z.string(),
    public_url: z.string(),
    token: z.string()
  })
  .transform((response) => ({
    uploadUrl: response.upload_url,
    publicUrl: response.public_url,
    token: response.token
  }))

export const zHubWorkflowPublishResponse = z.object({
  share_id: z.string(),
  workflow_id: z.string(),
  thumbnail_type: z.enum(['image', 'video', 'image_comparison']).optional()
})

const zHubLabelInfo = z.object({
  name: z.string(),
  display_name: z.string(),
  type: z.enum(['tag', 'model', 'custom_node'])
})

export const zHubLabelListResponse = z.object({
  labels: z.array(zHubLabelInfo)
})
