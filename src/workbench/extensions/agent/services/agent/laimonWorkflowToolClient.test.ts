import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { api } from '@/scripts/api'
import { reportError } from '@/platform/telemetry/reportError'

import { createLaimonWorkflowToolClient } from './laimonWorkflowToolClient'

vi.mock(import('@/scripts/api'))
vi.mock(import('@/platform/telemetry/reportError'))

describe('Laimon tool transport', () => {
  it('returns structured MCP-style results using the authenticated API transport', async () => {
    vi.mocked(api.fetchApi).mockImplementationOnce(async (_route, init) => {
      const request = z
        .object({ id: z.string() })
        .parse(JSON.parse(String(init?.body)))
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            isError: false,
            content: [{ type: 'text', text: '{}' }],
            structuredContent: { found: true }
          }
        })
      )
    })
    const outcome = await createLaimonWorkflowToolClient().callTool('nodes', {
      action: 'show',
      name: 'KSampler'
    })
    expect(outcome).toMatchObject({
      ok: true,
      result: { structuredContent: { found: true } }
    })
  })

  it('does not turn a tool approval request into an automatic save', async () => {
    vi.mocked(api.fetchApi).mockImplementationOnce(async (_route, init) => {
      const request = z
        .object({ id: z.string() })
        .parse(JSON.parse(String(init?.body)))
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            isError: true,
            structuredContent: { error: 'confirmation_required' },
            content: []
          }
        })
      )
    })
    const outcome = await createLaimonWorkflowToolClient().callTool(
      'save_workflow',
      { out_path: 'workflows/a.json' }
    )
    expect(outcome).toMatchObject({ ok: true, result: { isError: true } })
    expect(api.fetchApi).toHaveBeenCalledOnce()
  })

  it('refused confirmation makes no write request', async () => {
    expect(
      await createLaimonWorkflowToolClient().confirmSave(
        { out_path: 'workflows/a.json', workflow_json: '{}' },
        false
      )
    ).toEqual({ ok: false, reason: 'cancelled' })
    expect(api.fetchApi).not.toHaveBeenCalled()
  })

  it('confirmed save uses the separate UI command with the exact reviewed arguments', async () => {
    vi.mocked(api.fetchApi).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          isError: false,
          structuredContent: { saved: true },
          content: []
        })
      )
    )
    const args = {
      out_path: 'workflows/new.json',
      workflow_json: '{"nodes":[]}'
    }
    const outcome = await createLaimonWorkflowToolClient().confirmSave(
      args,
      true
    )
    expect(outcome).toMatchObject({
      ok: true,
      result: { structuredContent: { saved: true } }
    })
    const [route, init] = vi.mocked(api.fetchApi).mock.calls[0]
    expect(route).toBe('/workflow-assistant/confirm')
    expect(JSON.parse(String(init?.body))).toEqual({
      name: 'save_workflow',
      arguments: args,
      confirmed: true
    })
  })

  it('rejects a mismatched RPC response without applying anything', async () => {
    vi.mocked(api.fetchApi).mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 'wrong', result: {} }))
    )
    expect(await createLaimonWorkflowToolClient().listTools()).toEqual({
      ok: false,
      reason: 'invalid-response'
    })
    expect(reportError).toHaveBeenCalledOnce()
  })

  it.for([401, 403, 429, 500])(
    'returns HTTP %s as a failure without retrying',
    async (status) => {
      vi.mocked(api.fetchApi).mockResolvedValueOnce(
        new Response('{}', { status })
      )
      expect(await createLaimonWorkflowToolClient().listTools()).toEqual({
        ok: false,
        reason: 'http',
        httpStatus: status
      })
      expect(api.fetchApi).toHaveBeenCalledOnce()
      expect(reportError).toHaveBeenCalledOnce()
    }
  )

  it('reports an ambiguous network outcome without automatic replay', async () => {
    vi.mocked(api.fetchApi).mockRejectedValueOnce(new TypeError('offline'))
    expect(
      await createLaimonWorkflowToolClient().confirmSave(
        { out_path: 'workflows/a.json', workflow_json: '{}' },
        true
      )
    ).toEqual({ ok: false, reason: 'network' })
    expect(api.fetchApi).toHaveBeenCalledOnce()
  })
})
