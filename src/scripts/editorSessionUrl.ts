export function appendEditorSession(url: string, clientId: string): string {
  if (!clientId.startsWith('eds_')) return url

  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}client_id=${encodeURIComponent(clientId)}`
}
