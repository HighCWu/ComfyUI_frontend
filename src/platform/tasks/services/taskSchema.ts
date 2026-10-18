import { z } from 'zod'

import { zTaskResponse as zGeneratedTaskResponse } from '@comfyorg/ingest-types/zod'

const zTaskStatus = z.union([
  zGeneratedTaskResponse.shape.status,
  z.literal('cancelled')
])

export const zTaskResponse = zGeneratedTaskResponse.extend({
  status: zTaskStatus
})

export type TaskResponse = z.infer<typeof zTaskResponse>
export type TaskStatus = TaskResponse['status']
