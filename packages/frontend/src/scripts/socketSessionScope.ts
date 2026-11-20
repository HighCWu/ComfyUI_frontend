const markerKey = 'comfy:socket-scope'

export function adoptSocketSessionScope(
  scope: string | undefined,
  storage: Pick<Storage, 'getItem' | 'setItem'>
): boolean {
  if (scope === undefined) return false
  const changed = storage.getItem(markerKey) !== scope
  storage.setItem(markerKey, scope)
  return changed
}
