import axios from 'axios'
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/scripts/api'
import { collectCrdtDebugReport } from '@/workbench/extensions/agent/crdt/crdtDebugReport'

vi.mock(import('axios'))

describe('api.getLogs', () => {
  it.for([
    {
      name: 'local JSON string',
      data: '2026-09-15T12:34:56 - ready\n',
      expected: '2026-09-15T12:34:56 - ready\n'
    },
    {
      name: 'cloud JSON array',
      data: [{ level: 'info', message: 'System is running normally' }],
      expected:
        '[\n  {\n    "level": "info",\n    "message": "System is running normally"\n  }\n]'
    },
    {
      name: 'empty response body',
      data: undefined,
      expected: ''
    }
  ])('returns text for $name', async ({ data, expected }) => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data })

    await expect(api.getLogs()).resolves.toBe(expected)
  })

  it('validates and normalizes the structured terminal snapshot', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        entries: [{ m: 'ready\n', t: 17 }, {}],
        size: { cols: 120, rows: 40 }
      }
    })

    await expect(api.getRawLogs()).resolves.toEqual({
      entries: [{ m: 'ready\n', t: 17 }, { m: '' }],
      size: { cols: 120, rows: 40 }
    })
  })

  it('fills optional native terminal fields', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: {} })

    await expect(api.getRawLogs()).resolves.toEqual({
      entries: [],
      size: { cols: 80, rows: 24 }
    })
  })

  it.for([null, [], { entries: 'ready' }, { size: { rows: '40' } }])(
    'rejects a malformed structured terminal snapshot %#',
    async (data) => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data })

      await expect(api.getRawLogs()).rejects.toThrow()
    }
  )

  it('collects a report through the real API with the cloud log response', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: [{ level: 'info', message: 'System is running normally' }]
    })
    vi.spyOn(api, 'getSystemStats').mockRejectedValue(new Error('offline'))

    const report = await collectCrdtDebugReport({
      sources: { serverLogs: true, settings: false, workflow: false },
      events: [],
      crdt: {
        status: {
          enabled: true,
          connected: false,
          workflowId: 'doc-1',
          terminal: null,
          updatesApplied: 0,
          lastFrameType: null,
          outcomes: {
            received: 0,
            applied: 0,
            appliedLive: 0,
            skipped: 0,
            errored: 0,
            gap: 0,
            reset: 0,
            dropped: 0
          }
        },
        tabId: null,
        lastSeq: null,
        schemaError: null,
        meta: {},
        nodeIds: [],
        linkIds: [],
        appliedOpIds: [],
        stamps: {}
      }
    })

    expect(report).toContain('"message": "System is running normally"')
    expect(report).toContain('"level": "info"')
    expect(report).toContain('System stats unavailable: Error: offline')
  })
})
