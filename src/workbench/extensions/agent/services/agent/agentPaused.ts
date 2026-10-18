import { zAgentPendingPaused } from '@comfyorg/ingest-types/zod'

export const agentPausedSchema = zAgentPendingPaused.refine(
  (ask) =>
    ask.options.length === 1 &&
    ask.options[0].id === 'resume' &&
    ask.min_selections === 1 &&
    ask.max_selections === 1 &&
    !ask.allow_other &&
    ['step_limit', 'output_limit'].includes(ask.context.reason) &&
    ask.context.recheck_after_seconds === 0
)
