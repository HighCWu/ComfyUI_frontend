import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchApi: vi.fn(),
  loadGraphData: vi.fn()
}))

vi.mock('@/scripts/api', () => ({
  api: { fetchApi: mocks.fetchApi }
}))

vi.mock('@/scripts/app', () => ({
  app: { loadGraphData: mocks.loadGraphData }
}))

import { useEditorLaunchWorkflow } from './useEditorLaunchWorkflow'

describe('useEditorLaunchWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    expect(loaded).toBe(true)
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
      false
    )
    expect(mocks.fetchApi).not.toHaveBeenCalled()
  })
})
