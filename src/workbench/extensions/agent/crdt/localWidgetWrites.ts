import { isEqual } from 'es-toolkit'

import type { GraphOperation } from './graphOperations'

type SetWidgetOp = Extract<GraphOperation, { op: 'set_widget' }>
type ResolveInterior = (
  path: readonly (string | number)[]
) => string | undefined

export class LocalWidgetWrites {
  private readonly pending = new Map<string, unknown>()

  note(
    operations: readonly GraphOperation[],
    resolveInterior?: ResolveInterior
  ): void {
    for (const op of widgetTargets(operations, resolveInterior)) {
      this.pending.set(registerKey(op.nodeId, op.widget), op.value)
    }
  }

  /** Lifts the hold of every register whose settled op carried its latest value. */
  settle(
    operations: readonly GraphOperation[],
    resolveInterior?: ResolveInterior
  ): void {
    for (const op of widgetTargets(operations, resolveInterior)) {
      this.holds(op.nodeId, op.widget, op.value)
    }
  }

  /** Lifts the hold of every register the document has caught up on. */
  settleAgainst(docValue: (nodeId: string, widget: string) => unknown): void {
    for (const key of Array.from(this.pending.keys())) {
      const [nodeId, widget] = splitKey(key)
      this.holds(nodeId, widget, docValue(nodeId, widget))
    }
  }

  /**
   * True while a local write to the register is in flight and `docValue` is
   * not it. A matching value settles the write and lets the frame through.
   */
  holds(nodeId: string, widget: string, docValue: unknown): boolean {
    const key = registerKey(nodeId, widget)
    if (!this.pending.has(key)) return false
    if (!isEqual(this.pending.get(key), docValue)) return true
    this.pending.delete(key)
    return false
  }

  clear(): void {
    this.pending.clear()
  }
}

function widgetTargets(
  operations: readonly GraphOperation[],
  resolveInterior?: ResolveInterior
) {
  return operations
    .filter((op): op is SetWidgetOp => op.op === 'set_widget')
    .flatMap((op) => {
      const nodeId =
        op.path == null ? String(op.node_id) : resolveInterior?.(op.path)
      const widget = op.path == null ? op.widget : op.inner_widget
      return nodeId !== undefined && typeof widget === 'string'
        ? [{ nodeId, widget, value: op.value }]
        : []
    })
}

const KEY_SEPARATOR = '\u0000'

function registerKey(nodeId: string | number, widget: string): string {
  return `${String(nodeId)}${KEY_SEPARATOR}${widget}`
}

function splitKey(key: string): [nodeId: string, widget: string] {
  const at = key.indexOf(KEY_SEPARATOR)
  return [key.slice(0, at), key.slice(at + KEY_SEPARATOR.length)]
}
