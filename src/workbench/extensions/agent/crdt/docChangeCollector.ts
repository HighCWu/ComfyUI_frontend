import {
  linksMap,
  nodesMap,
  OPAQUE_WIDGETS_KEY
} from '@comfyorg/comfy-multi-player'
import * as Y from 'yjs'

import type { FrameChanges, NodeChange } from './liveGraphApplier'
import { SYNCED_NODE_FIELDS } from './liveGraphApplier'

/**
 * Collects what the Y observers on one follower document report between two
 * `take()` calls, in the shape the applier consumes. Observers fire
 * synchronously inside `applyRemoteUpdate`, so the frame that delivered an
 * update sees exactly that update's changes. Changes stay collected until a
 * graph is there to take them, so a frame delivered before the graph loads is
 * applied once it does.
 */
export class DocChangeCollector {
  private readonly nodes = new Map<string, NodeChange>()
  private readonly widgets = new Map<string, Set<string> | 'all'>()
  private readonly resyncNodes = new Set<string>()
  private readonly links = new Set<string>()
  private readonly nodesMap: Y.Map<Y.Map<unknown>>
  private readonly linksMap: Y.Map<unknown>
  private readonly definitions: Y.Map<unknown>
  private readonly interiorTopology = new Set<string>()
  private readonly registeredDefinitions = new Set<string>()
  private readonly interiorWidgets = new Map<
    string,
    Map<string, Set<string> | 'all'>
  >()

  constructor(doc: Y.Doc) {
    this.nodesMap = nodesMap(doc)
    this.linksMap = linksMap(doc)
    this.definitions = doc.getMap('definitions')
    this.nodesMap.observeDeep(this.onNodesChanged)
    this.linksMap.observe(this.onLinksChanged)
    this.definitions.observeDeep(this.onDefinitionsChanged)
  }

  /** Returns everything collected so far without clearing it. */
  peek(): FrameChanges {
    return {
      nodes: new Map(this.nodes),
      widgets: new Map(this.widgets),
      resyncNodes: new Set(this.resyncNodes),
      links: new Set(this.links),
      ...(this.registeredDefinitions.size
        ? { registeredDefinitions: new Set(this.registeredDefinitions) }
        : {}),
      ...(this.interiorTopology.size
        ? { interiorTopology: new Set(this.interiorTopology) }
        : {}),
      ...(this.interiorWidgets.size
        ? {
            interiorWidgets: new Map(
              [...this.interiorWidgets].map(([id, nodes]) => [
                id,
                new Map(
                  [...nodes].map(([node, names]) => [
                    node,
                    names === 'all' ? names : new Set(names)
                  ])
                )
              ])
            )
          }
        : {})
    }
  }

  /** Returns and clears everything collected so far. */
  take(): FrameChanges {
    const changes = this.peek()
    this.discard()
    return changes
  }

  discard(): void {
    this.nodes.clear()
    this.widgets.clear()
    this.resyncNodes.clear()
    this.links.clear()
    this.interiorWidgets.clear()
    this.interiorTopology.clear()
    this.registeredDefinitions.clear()
  }

  destroy(): void {
    this.nodesMap.unobserveDeep(this.onNodesChanged)
    this.linksMap.unobserve(this.onLinksChanged)
    this.definitions.unobserveDeep(this.onDefinitionsChanged)
    this.discard()
  }

  private readonly onNodesChanged = (
    events: Y.YEvent<Y.AbstractType<unknown>>[]
  ): void => {
    for (const event of events) {
      if (event instanceof Y.YArrayEvent) this.onOpaqueWidgetsChanged(event)
      else if (event instanceof Y.YMapEvent) this.onNodeMapChanged(event)
    }
  }

  private onNodeMapChanged(event: Y.YMapEvent<unknown>): void {
    if (event.target === this.nodesMap) this.onNodeEntriesChanged(event)
    else if (event.path.length === 1) this.onNodeFieldsChanged(event)
    else if (event.path[1] === 'widgets') this.onNamedWidgetsChanged(event)
    else if (event.path[1] === 'flags')
      this.resyncNodes.add(String(event.path[0]))
  }

  private onOpaqueWidgetsChanged(event: Y.YArrayEvent<unknown>): void {
    if (event.path.length === 2 && event.path[1] === OPAQUE_WIDGETS_KEY)
      this.widgets.set(String(event.path[0]), 'all')
  }

  private onNodeEntriesChanged(event: Y.YMapEvent<unknown>): void {
    for (const [id, change] of event.changes.keys)
      this.nodes.set(id, change.action)
  }

  private onNamedWidgetsChanged(event: Y.YMapEvent<unknown>): void {
    const id = String(event.path[0])
    const current = this.widgets.get(id)
    if (current === 'all') return
    const names = current ?? new Set<string>()
    for (const name of event.keysChanged) names.add(name)
    this.widgets.set(id, names)
  }

  private onNodeFieldsChanged(event: Y.YMapEvent<unknown>): void {
    const id = String(event.path[0])
    if (
      event.keysChanged.has('widgets') ||
      event.keysChanged.has(OPAQUE_WIDGETS_KEY)
    )
      this.widgets.set(id, 'all')
    if ([...event.keysChanged].some((key) => SYNCED_NODE_FIELDS.has(key)))
      this.resyncNodes.add(id)
  }

  private readonly onLinksChanged = (event: Y.YMapEvent<unknown>): void => {
    for (const id of event.keysChanged) this.links.add(id)
  }

  private readonly onDefinitionsChanged = (
    events: Y.YEvent<Y.AbstractType<unknown>>[]
  ): void => {
    for (const event of events) {
      this.collectInteriorTopology(event)
      const at = event.path.lastIndexOf('nodes')
      if (at < 1) continue
      const named =
        event instanceof Y.YMapEvent &&
        event.path.length === at + 3 &&
        event.path.at(-1) === 'widgets'
      const replaced =
        event instanceof Y.YMapEvent &&
        event.path.length === at + 2 &&
        (event.keysChanged.has('widgets') ||
          event.keysChanged.has(OPAQUE_WIDGETS_KEY))
      const opaque =
        event instanceof Y.YArrayEvent &&
        event.path.length === at + 3 &&
        event.path.at(-1) === OPAQUE_WIDGETS_KEY
      if (!named && !replaced && !opaque) continue
      const definitionId = String(event.path[at - 1])
      const nodeId = String(event.path[at + 1])
      const nodes =
        this.interiorWidgets.get(definitionId) ??
        new Map<string, Set<string> | 'all'>()
      const prior = nodes.get(nodeId)
      nodes.set(
        nodeId,
        prior === 'all' || !named
          ? 'all'
          : new Set([...(prior ?? []), ...event.keysChanged])
      )
      this.interiorWidgets.set(definitionId, nodes)
    }
  }

  private collectInteriorTopology(
    event: Y.YEvent<Y.AbstractType<unknown>>
  ): void {
    let offset = 0
    while (
      event.path[offset + 1] === 'definitions' &&
      event.path[offset + 2] === 'subgraphs'
    )
      offset += 3
    if (event.path.length === offset && event instanceof Y.YMapEvent) {
      for (const [id, change] of event.changes.keys)
        if (change.action === 'add') this.registeredDefinitions.add(id)
        else this.interiorTopology.add(id)
      return
    }
    const id = event.path[offset]
    if (typeof id !== 'string') return
    const path = event.path.slice(offset + 1)
    const structuralFields = new Set(['nodes', 'links', 'inputs', 'outputs'])
    if (
      (path.length === 0 &&
        event instanceof Y.YMapEvent &&
        [...event.keysChanged].some((key) => structuralFields.has(key))) ||
      ['links', 'inputs', 'outputs'].includes(String(path[0])) ||
      (path[0] === 'nodes' &&
        (path.length === 1 ||
          (path.length === 2 &&
            event instanceof Y.YMapEvent &&
            [...event.keysChanged].some((key) =>
              ['type', 'inputs', 'outputs'].includes(key)
            )) ||
          ['inputs', 'outputs'].includes(String(path[2]))))
    )
      this.interiorTopology.add(id)
  }
}
