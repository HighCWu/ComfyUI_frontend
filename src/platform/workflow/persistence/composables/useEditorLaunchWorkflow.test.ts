import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fromPartial } from '@total-typescript/shoehorn'

import type { ComfyApi } from '@/scripts/api'
import type { ComfyApp } from '@/scripts/app'
import type { useWorkflowService } from '@/platform/workflow/core/services/workflowService'
import {
  ComfyWorkflow,
  useWorkflowStore
} from '@/platform/workflow/management/stores/workflowStore'
import { reportError } from '@/platform/telemetry/reportError'

const mocks = vi.hoisted(() => ({
  fetchApi: vi.fn(),
  isApiJson: vi.fn(),
  loadApiJson: vi.fn(),
  loadGraphData: vi.fn(),
  openWorkflow: vi.fn<ReturnType<typeof useWorkflowService>['openWorkflow']>()
}))

vi.mock(import('@/platform/workflow/core/services/workflowService'), () => ({
  useWorkflowService: () =>
    fromPartial<ReturnType<typeof useWorkflowService>>({
      openWorkflow: mocks.openWorkflow
    })
}))
vi.mock(import('@/platform/telemetry/reportError'), () => ({
  reportError: vi.fn()
}))

vi.mock(import('@/scripts/api'), () => ({
  api: fromPartial<ComfyApi>({ fetchApi: mocks.fetchApi })
}))

vi.mock(import('@/scripts/app'), () => ({
  app: fromPartial<ComfyApp>({
    isApiJson: mocks.isApiJson,
    loadApiJson: mocks.loadApiJson,
    loadGraphData: mocks.loadGraphData
  })
}))

import { useEditorLaunchWorkflow } from './useEditorLaunchWorkflow'

describe('useEditorLaunchWorkflow', () => {
  beforeEach(() => {
    mocks.isApiJson.mockReturnValue(false)
    window.name = ''
  })

  it('loads the workflow bound to the iframe editor session', async () => {
    window.name = 'eds_instance-one'
    mocks.fetchApi.mockResolvedValue(
      Response.json({
        launch: {
          label: 'Video workflow.json',
          workflow: { nodes: [] }
        }
      })
    )

    const loaded = await useEditorLaunchWorkflow().loadEditorLaunchWorkflow()

    expect(loaded).toBe('loaded')
    expect(mocks.fetchApi).toHaveBeenCalledWith(
      '/editor-launch?client_id=eds_instance-one',
      { cache: 'no-store' }
    )
    expect(mocks.loadGraphData).toHaveBeenCalledWith(
      { nodes: [] },
      true,
      true,
      'Video workflow.json'
    )
  })

  it('does not request a launch outside an instance iframe', async () => {
    expect(await useEditorLaunchWorkflow().loadEditorLaunchWorkflow()).toBe(
      'not-present'
    )
    expect(mocks.fetchApi).not.toHaveBeenCalled()
  })

  it('imports an API-format launch with the official API loader', async () => {
    window.name = 'eds_pool-api'
    const workflow = {
      '1': {
        class_type: 'UpscaleModelLoader',
        inputs: { model_name: 'model.pth' }
      }
    }
    mocks.isApiJson.mockReturnValue(true)
    mocks.fetchApi.mockResolvedValue(
      Response.json({ launch: { label: null, workflow } })
    )
    expect(await useEditorLaunchWorkflow().loadEditorLaunchWorkflow()).toBe(
      'loaded'
    )
    expect(mocks.isApiJson).toHaveBeenCalledWith(workflow)
    expect(mocks.loadApiJson).toHaveBeenCalledWith(workflow, 'Launch workflow')
    expect(mocks.loadGraphData).not.toHaveBeenCalled()
  })

  it.for([
    null,
    [],
    {},
    { launch: 'workflow' },
    { launch: { label: 17, workflow: {} } },
    { launch: { label: null, workflow: null } },
    {
      launch: {
        label: 'mixed',
        workflow: {},
        saved_workflow: { path: 'workflows/a.json' }
      }
    }
  ])('refuses a malformed successful launch payload', async (payload) => {
    window.name = 'eds_malformed'
    mocks.fetchApi.mockResolvedValue(Response.json(payload))

    expect(await useEditorLaunchWorkflow().loadEditorLaunchWorkflow()).toBe(
      'failed'
    )
    expect(mocks.isApiJson).not.toHaveBeenCalled()
    expect(mocks.loadApiJson).not.toHaveBeenCalled()
    expect(mocks.loadGraphData).not.toHaveBeenCalled()
  })
  it('opens the saved file through the native workflow service without importing a temporary copy', async () => {
    window.name = 'eds_saved'
    const file = new ComfyWorkflow({
      path: 'workflows/folder/saved.json',
      modified: 1,
      size: 10
    })
    const store = useWorkflowStore()
    vi.spyOn(store, 'syncWorkflows').mockResolvedValue(undefined)
    vi.spyOn(store, 'getWorkflowByPath').mockReturnValue(file)
    mocks.openWorkflow.mockResolvedValue(true)
    mocks.fetchApi.mockResolvedValue(
      Response.json({
        launch: { label: 'saved.json', saved_workflow: { path: file.path } }
      })
    )
    expect(await useEditorLaunchWorkflow().loadEditorLaunchWorkflow()).toBe(
      'loaded'
    )
    expect(mocks.openWorkflow).toHaveBeenCalledWith(file, { force: true })
    expect(mocks.loadGraphData).not.toHaveBeenCalled()
    expect(mocks.loadApiJson).not.toHaveBeenCalled()
  })
  it.for([404, 409, 503])(
    'reports a refused selected launch without opening another file (%s)',
    async (status) => {
      window.name = 'eds_refused'
      mocks.fetchApi.mockResolvedValue(new Response(null, { status }))
      expect(await useEditorLaunchWorkflow().loadEditorLaunchWorkflow()).toBe(
        'failed'
      )
      expect(mocks.openWorkflow).not.toHaveBeenCalled()
      expect(reportError).toHaveBeenCalledWith(expect.anything(), {
        errorType: 'error_loading_editor_launch',
        surface: 'graph'
      })
    }
  )
  it('does not fall back when the bound file is missing from the current native file list', async () => {
    window.name = 'eds_missing'
    const store = useWorkflowStore()
    vi.spyOn(store, 'syncWorkflows').mockResolvedValue(undefined)
    vi.spyOn(store, 'getWorkflowByPath').mockReturnValue(null)
    mocks.fetchApi.mockResolvedValue(
      Response.json({
        launch: {
          label: 'missing.json',
          saved_workflow: { path: 'workflows/missing.json' }
        }
      })
    )
    expect(await useEditorLaunchWorkflow().loadEditorLaunchWorkflow()).toBe(
      'failed'
    )
    expect(mocks.openWorkflow).not.toHaveBeenCalled()
    expect(mocks.loadGraphData).not.toHaveBeenCalled()
  })
  it.for(['workflows/../private.json', 'launch_workflows/private.json'])(
    'refuses a non-user-file launch path: %s',
    async (path) => {
      window.name = 'eds_bad_path'
      mocks.fetchApi.mockResolvedValue(
        Response.json({ launch: { label: 'bad', saved_workflow: { path } } })
      )
      expect(await useEditorLaunchWorkflow().loadEditorLaunchWorkflow()).toBe(
        'failed'
      )
      expect(mocks.openWorkflow).not.toHaveBeenCalled()
    }
  )
  it('preserves ordinary blank editor sessions as a missing launch intent', async () => {
    window.name = 'eds_blank'
    mocks.fetchApi.mockResolvedValue(Response.json({ launch: null }))
    expect(await useEditorLaunchWorkflow().loadEditorLaunchWorkflow()).toBe(
      'not-present'
    )
    expect(reportError).not.toHaveBeenCalled()
  })
})
