import { zAgentPendingDeleteApproval } from '@comfyorg/ingest-types/zod'

export const agentDeletionSchema = zAgentPendingDeleteApproval.refine(
  (ask) =>
    ask.options.length === 2 &&
    ask.options.some((option) => option.id === 'delete') &&
    ask.options.some((option) => option.id === 'keep') &&
    ask.min_selections === 1 &&
    ask.max_selections === 1 &&
    !ask.allow_other &&
    new Set(ask.context.nodes.map((node) => node.id)).size ===
      ask.context.nodes.length
)
