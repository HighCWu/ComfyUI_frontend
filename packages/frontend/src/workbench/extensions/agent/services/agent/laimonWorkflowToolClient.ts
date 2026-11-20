import { z } from 'zod'

import { api } from '@/scripts/api'
import { reportError } from '@/platform/telemetry/reportError'

type RequestOutcome =
  | { ok: true; result: unknown }
  | {
      ok: false
      reason:
        | 'cancelled'
        | 'network'
        | 'http'
        | 'invalid-response'
        | 'rpc-error'
      httpStatus?: number
    }

const rpcResponse = z.union([
  z
    .object({
      jsonrpc: z.literal('2.0'),
      id: z.string(),
      result: z.unknown()
    })
    .strict(),
  z
    .object({
      jsonrpc: z.literal('2.0'),
      id: z.union([z.string(), z.null()]),
      error: z.object({ code: z.number(), message: z.string() })
    })
    .strict()
])

/** Authenticated MCP-style tool transport; confirmation is never automatic. */
export function createLaimonWorkflowToolClient() {
  async function post(
    route: string,
    body: unknown,
    signal?: AbortSignal
  ): Promise<RequestOutcome> {
    let response: Response
    try {
      response = await api.fetchApi(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
        signal
      })
    } catch (cause) {
      if (signal?.aborted) return { ok: false, reason: 'cancelled' }
      reportError(cause, {
        surface: 'agent',
        errorType: 'error_calling_workflow_tool'
      })
      return { ok: false, reason: 'network' }
    }
    if (!response.ok) {
      reportError(response.statusText, {
        surface: 'agent',
        errorType: 'error_calling_workflow_tool',
        context: { status: response.status }
      })
      return { ok: false, reason: 'http', httpStatus: response.status }
    }
    try {
      return { ok: true, result: await response.json() }
    } catch (cause) {
      if (signal?.aborted) return { ok: false, reason: 'cancelled' }
      reportError(cause, {
        surface: 'agent',
        errorType: 'error_reading_workflow_tool_response'
      })
      return { ok: false, reason: 'invalid-response' }
    }
  }

  async function rpc(
    method: 'tools/list' | 'tools/call',
    params?: { name: string; arguments: Record<string, unknown> },
    signal?: AbortSignal
  ): Promise<RequestOutcome> {
    const id = crypto.randomUUID()
    const outcome = await post(
      '/workflow-assistant/rpc',
      { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) },
      signal
    )
    if (!outcome.ok) return outcome
    const parsed = rpcResponse.safeParse(outcome.result)
    if (!parsed.success || parsed.data.id !== id) {
      reportError('Invalid workflow tool envelope', {
        surface: 'agent',
        errorType: 'error_reading_workflow_tool_response'
      })
      return { ok: false, reason: 'invalid-response' }
    }
    if ('error' in parsed.data) return { ok: false, reason: 'rpc-error' }
    return { ok: true, result: parsed.data.result }
  }

  return {
    listTools(signal?: AbortSignal) {
      return rpc('tools/list', undefined, signal)
    },
    callTool(
      name: string,
      args: Record<string, unknown>,
      signal?: AbortSignal
    ) {
      return rpc('tools/call', { name, arguments: args }, signal)
    },
    confirmSave(
      args: { out_path: string; workflow_json: string },
      userConfirmed: boolean,
      signal?: AbortSignal
    ): Promise<RequestOutcome> {
      if (!userConfirmed) {
        return Promise.resolve({ ok: false, reason: 'cancelled' })
      }
      return post(
        '/workflow-assistant/confirm',
        { name: 'save_workflow', arguments: args, confirmed: true },
        signal
      )
    }
  }
}
