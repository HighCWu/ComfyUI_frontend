export function appendEditorSession(url: string, clientId: string): string {
  if (!clientId.startsWith('eds_')) return url

  const fragmentIndex = url.indexOf('#')
  const fragment = fragmentIndex < 0 ? '' : url.slice(fragmentIndex)
  const address = fragmentIndex < 0 ? url : url.slice(0, fragmentIndex)
  const queryIndex = address.indexOf('?')
  const path = queryIndex < 0 ? address : address.slice(0, queryIndex)
  const query = new URLSearchParams(
    queryIndex < 0 ? '' : address.slice(queryIndex + 1)
  )
  query.set('client_id', clientId)
  return `${path}?${query}${fragment}`
}

export function editorSessionFromNavigation(search: string): string | null {
  const sessions = new URLSearchParams(search).getAll('client_id')
  if (sessions.length !== 1) return null
  const clientId = sessions[0]
  return /^eds_[a-zA-Z0-9_-]{1,124}$/.test(clientId) ? clientId : null
}

export function updateEditorSessionNavigation(clientId: string): void {
  const url = new URL(window.location.href)
  if (url.pathname !== '/comfy/' || !url.searchParams.has('client_id')) return
  if (/^eds_[a-zA-Z0-9_-]{1,124}$/.test(clientId)) {
    url.searchParams.set('client_id', clientId)
  } else {
    url.searchParams.delete('client_id')
  }
  window.history.replaceState(window.history.state, '', url)
}
