export function createKeyUsageMatcher(sourceContents: readonly string[]) {
  const quotedKeys = new Set(
    sourceContents.flatMap((content) =>
      Array.from(
        content.matchAll(/(?=['"`]([^'"`]*)['"`])/g),
        (match) => match[1]
      )
    )
  )
  const namespaceMatches = new Map<string, boolean>()
  const escapeRegex = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return (key: string): boolean => {
    if (quotedKeys.has(key)) return true
    if (/['"`]/.test(key)) {
      const literal = new RegExp(`['"\`]${escapeRegex(key)}['"\`]`)
      if (sourceContents.some((content) => literal.test(content))) return true
    }

    const lastPart = key.split('.').pop() ?? ''
    const cached = namespaceMatches.get(lastPart)
    if (cached !== undefined) return cached
    const namespace = new RegExp(
      `[t$]\\s*\\(\\s*['"\`][^'"]+\\.${escapeRegex(lastPart)}['"\`]`
    )
    const used = sourceContents.some((content) => namespace.test(content))
    namespaceMatches.set(lastPart, used)
    return used
  }
}
