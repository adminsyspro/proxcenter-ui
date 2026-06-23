export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
export function sanitizeFilename(s: string): string {
  return String(s)
    .replace(/\.\.+/g, '')
    .replace(/[/\\]+/g, '-')
    .replace(/["'`<>]+/g, '-')
    .replace(/\s+/g, '')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
}
