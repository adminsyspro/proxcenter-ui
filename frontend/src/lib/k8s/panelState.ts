export function panelMessage(s: { status: string; errorCode?: string; truncated?: boolean }):
  { tone: 'info' | 'warning' | 'error'; key: string } | null {
  if (s.status === 'forbidden' || s.errorCode === 'forbidden') return { tone: 'warning', key: 'forbidden' }
  if (s.errorCode === 'not_found') return { tone: 'info', key: 'notFound' }
  if (s.errorCode === 'auth_failed') return { tone: 'error', key: 'authFailed' }
  if (s.status === 'error' || s.errorCode === 'unreachable') return { tone: 'error', key: 'unreachable' }
  if (s.status === 'ok' && s.truncated) return { tone: 'warning', key: 'truncated' }
  return null
}
