import { expect, it, vi } from 'vitest'

import { ComfyWorkflow } from '@/platform/workflow/management/stores/comfyWorkflow'
import { reportError } from '@/platform/telemetry/reportError'

import { checkpointNativeRunPlan } from './nativeRunPlanCheckpoint'

vi.mock(import('@/platform/telemetry/reportError'))

it('checkpoints a native temporary graph without opening Save As or changing its binding', async () => {
  const workflow = new ComfyWorkflow({
    path: 'workflows/Unsaved Workflow.json',
    modified: 1,
    size: -1
  })
  const save = vi.fn(async () => false)
  const draft = { nodes: [{ id: 1, type: 'LoadImage' }], links: [] }

  expect(await checkpointNativeRunPlan(workflow, save, () => draft)).toBe(draft)
  expect(save).not.toHaveBeenCalled()
  expect(workflow.path).toBe('workflows/Unsaved Workflow.json')
})

it('saves an existing file before reading its current draft', async () => {
  const workflow = new ComfyWorkflow({
    path: 'workflows/Image.json',
    modified: 1,
    size: 1
  })
  let draft = { nodes: [], checkpointed: false }
  const save = vi.fn(async () => {
    draft = { nodes: [], checkpointed: true }
    return true
  })

  expect(await checkpointNativeRunPlan(workflow, save, () => draft)).toEqual({
    nodes: [],
    checkpointed: true
  })
  expect(save).toHaveBeenCalledWith(workflow)
})

it('does not preview after a cancelled file save', async () => {
  const readDraft = vi.fn(() => ({ nodes: [] }))
  expect(
    await checkpointNativeRunPlan(
      new ComfyWorkflow({ path: 'workflows/Image.json', modified: 1, size: 1 }),
      async () => false,
      readDraft
    )
  ).toBeNull()
  expect(readDraft).not.toHaveBeenCalled()
})

it('refuses a draft whose active binding changed during save', async () => {
  expect(
    await checkpointNativeRunPlan(
      new ComfyWorkflow({ path: 'workflows/Image.json', modified: 1, size: 1 }),
      async () => true,
      () => null
    )
  ).toBeNull()
})

it('reports a failed checkpoint without returning a runnable draft', async () => {
  expect(
    await checkpointNativeRunPlan(
      new ComfyWorkflow({ path: 'workflows/Image.json', modified: 1, size: 1 }),
      () => Promise.reject(new TypeError('save unavailable')),
      () => ({ nodes: [] })
    )
  ).toBeNull()
  expect(reportError).toHaveBeenCalledWith(
    'Native workflow checkpoint unavailable',
    {
      surface: 'agent',
      errorType: 'native_run_plan_checkpoint_failed'
    }
  )
})
