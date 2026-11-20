import { zGetNodeReplacementsResponse } from '@comfyorg/ingest-types/zod'
import { z } from 'zod'

const inputMapSchema = z.union([
  z.object({ new_id: z.string(), old_id: z.string() }),
  z.object({ new_id: z.string(), set_value: z.unknown() })
])
const outputMapSchema = z.object({ new_idx: z.number(), old_idx: z.number() })
const nodeReplacementSchema = z.object({
  new_node_id: z.string(),
  old_node_id: z.string(),
  old_widget_ids: z.array(z.string()).nullable(),
  input_mapping: z.array(inputMapSchema).nullable(),
  output_mapping: z.array(outputMapSchema).nullable()
})

export const nodeReplacementResponseSchema = zGetNodeReplacementsResponse.pipe(
  z.record(z.string(), z.array(nodeReplacementSchema))
)

export type NodeReplacement = z.infer<typeof nodeReplacementSchema>
export type NodeReplacementResponse = z.infer<
  typeof nodeReplacementResponseSchema
>

export type MissingNodeType =
  | string
  // Primarily used by group nodes.
  | {
      type: string
      nodeId?: string | number
      cnrId?: string
      hint?: string
      action?: {
        text: string
        callback: () => void
      }
      isReplaceable?: boolean
      replacement?: NodeReplacement
    }
