import { expect, it, onTestFinished, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

import { useExecutionStore } from '@/stores/executionStore'

import { useProgressFavicon } from './useProgressFavicon'

it.for(['/', '/comfy/'])(
  'keeps idle and progress icons inside the %s deployment base',
  async (base) => {
    vi.stubEnv('BASE_URL', base)
    const icon = document.createElement('link')
    icon.rel = 'icon'
    document.head.append(icon)
    const scope = effectScope()
    onTestFinished(() => {
      scope.stop()
      icon.remove()
    })
    scope.run(useProgressFavicon)
    await nextTick()
    expect(icon.getAttribute('href')).toBe(
      `${base}assets/images/favicon_progress_16x16/frame_9.png`
    )
    const execution = useExecutionStore()
    execution.queuedJobs = {
      'progress-qa': { nodes: { first: true, second: false } }
    }
    execution.activeJobId = 'progress-qa'
    await nextTick()
    expect(icon.getAttribute('href')).toBe(
      `${base}assets/images/favicon_progress_16x16/frame_5.png`
    )
    execution.activeJobId = null
    await nextTick()
    expect(icon.getAttribute('href')).toBe(
      `${base}assets/images/favicon_progress_16x16/frame_9.png`
    )
  }
)
