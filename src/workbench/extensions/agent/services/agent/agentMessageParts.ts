import type { TurnId } from '../../schemas/agentApiSchema'
import type {
  AgentAskConflict,
  AgentPendingRunApproval,
  AgentPendingDeleteApproval,
  AgentPendingPaused,
  AgentPendingAskUser,
  AgentAnswerRequest
} from '@comfyorg/ingest-types'

export type AgentAskSelection = 'run' | 'cancel' | AgentAnswerRequest

export type PartState = 'streaming' | 'done'

export interface TextPart {
  type: 'text'
  text: string
  state: PartState
}

export interface ToolPart {
  type: 'tool'
  callId: string
  name: string
  skill?: string
  state: PartState
  ok?: boolean
  durationMs?: number
}

export interface ThinkingPart {
  type: 'thinking'
  text: string
  state: PartState
  durationMs?: number
}

export interface NoticePart {
  type: 'notice'
  level: 'info' | 'warning' | 'error'
  text: string
  /**
   * Seconds the server asked the client to wait before retrying (parsed from
   * a `Retry-After` response header), e.g. on `funds_unavailable` admission
   * denials. Presentation-only - the caller decides whether/how to honour it
   * (countdown, disabled input, auto-retry); never implies a scheduled retry
   * on its own.
   */
  retryAfterSeconds?: number
}

export interface TabLinkPart {
  type: 'tabLink'
  workflowId: string
  locatorId?: string
  name?: string
}

export interface RunApprovalPart {
  type: 'runApproval'
  askId: string
  workflowId?: string
  workflowName?: string
  prompt?: AgentPendingRunApproval['prompt']
  question?: AgentPendingAskUser
  deletion?: AgentPendingDeleteApproval
  paused?: AgentPendingPaused
  resolution?: AgentAskResolution
}

export type AgentAskResolution =
  | { status: 'answered'; selected: string[]; otherText?: string }
  | { status: 'closed' | 'unconfirmed' | 'retired' }

const UNANSWERED_RESOLUTION_SCORE: Record<
  Exclude<AgentAskResolution['status'], 'answered'>,
  number
> = { retired: 0, unconfirmed: 1, closed: 2 }

function resolutionScore(resolution: AgentAskResolution): number {
  if (resolution.status !== 'answered')
    return UNANSWERED_RESOLUTION_SCORE[resolution.status]
  if (resolution.otherText !== undefined) return 4
  return resolution.selected.length > 0 ? 3 : 1
}

export function settleAskResolution(
  shown: AgentAskResolution | undefined,
  next: AgentAskResolution
): AgentAskResolution {
  return shown === undefined || resolutionScore(next) > resolutionScore(shown)
    ? next
    : shown
}

export function toAskResolution({
  status,
  selected,
  other_text: otherText
}: Pick<
  AgentAskConflict,
  'status' | 'selected' | 'other_text'
>): AgentAskResolution {
  if (status === undefined) return { status: 'retired' }
  if (status !== 'answered') return { status: 'closed' }
  return otherText
    ? { status: 'answered', selected: selected ?? [], otherText }
    : { status: 'answered', selected: selected ?? [] }
}

export function retireAskParts(
  parts: MessagePart[],
  askId: string,
  resolution: AgentAskResolution
): MessagePart[] {
  const next = parts.flatMap((part): MessagePart[] => {
    if (part.type !== 'runApproval' || part.askId !== askId) return [part]
    if (!part.question && !part.deletion) return []
    const settled = settleAskResolution(part.resolution, resolution)
    return [
      settled === part.resolution ? part : { ...part, resolution: settled }
    ]
  })
  return next.length === parts.length &&
    next.every((part, index) => part === parts[index])
    ? parts
    : next
}

export interface PaywallPart {
  type: 'paywall'
  message?: string
}

export type ActivityPart = ThinkingPart | ToolPart

export type MessagePart =
  | TextPart
  | ThinkingPart
  | ToolPart
  | NoticePart
  | TabLinkPart
  | RunApprovalPart
  | PaywallPart

export interface AssistantMessage {
  id: TurnId
  role: 'assistant'
  parts: MessagePart[]
  streaming: boolean
  thinking: boolean
  thinkingText?: string
}

export function createAssistantMessage(id: TurnId): AssistantMessage {
  return {
    id,
    role: 'assistant',
    parts: [],
    streaming: true,
    thinking: false
  }
}

export function snapshotMessage(message: AssistantMessage): AssistantMessage {
  return { ...message, parts: message.parts.map((part) => ({ ...part })) }
}
