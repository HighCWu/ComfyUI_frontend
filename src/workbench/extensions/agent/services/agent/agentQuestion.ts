import { zAgentPendingAskUser } from '@comfyorg/ingest-types/zod'

export const agentQuestionSchema = zAgentPendingAskUser.refine(
  (ask) =>
    ask.options.length > 0 &&
    ask.options.length <= 10 &&
    new Set(ask.options.map((option) => option.id)).size ===
      ask.options.length &&
    ask.min_selections >= 0 &&
    ask.max_selections >= 1 &&
    ask.min_selections <= ask.max_selections &&
    ask.max_selections <= ask.options.length
)
