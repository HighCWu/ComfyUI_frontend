import { app } from '@/scripts/app'
import type { ComfyWorkflowJSON } from '@/platform/workflow/validation/schemas/workflowSchema'

type LaimonMessageType =
  | 'loadWorkflow'
  | 'clearWorkflow'
  | 'resetView'
  | 'getGraph'

interface LaimonMessage {
  type: LaimonMessageType
  graph?: unknown
  requestId?: string
}

const isInIframe = window.self !== window.top

if (isInIframe) {
  const queue: LaimonMessage[] = []
  let ready = false

  function postToParent(msg: Record<string, unknown>): void {
    window.parent.postMessage(msg, window.location.origin)
  }

  async function handle(msg: LaimonMessage): Promise<void> {
    switch (msg.type) {
      case 'loadWorkflow':
        try {
          await app.loadGraphData(
            msg.graph as ComfyWorkflowJSON | undefined,
            true,
            true
          )
          postToParent({ type: 'workflowLoaded' })
        } catch (err) {
          postToParent({
            type: 'error',
            message: err instanceof Error ? err.message : String(err)
          })
        }
        break
      case 'clearWorkflow':
        app.graph?.clear?.()
        break
      case 'resetView':
        app.resetView?.()
        break
      case 'getGraph':
        postToParent({
          type: 'graphData',
          requestId: msg.requestId,
          graph: app.graph?.serialize?.() ?? null
        })
        break
    }
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent) return
    if (event.origin !== window.location.origin) return
    const msg = event.data as LaimonMessage
    if (!msg || typeof msg.type !== 'string') return
    if (!ready) {
      queue.push(msg)
      return
    }
    void handle(msg)
  })

  app.registerExtension({
    name: 'Comfy.LaimonBridge',
    setup() {
      ready = true
      postToParent({ type: 'appJsLoaded' })
      while (queue.length > 0) {
        const msg = queue.shift()
        if (msg) void handle(msg)
      }
    }
  })
}
