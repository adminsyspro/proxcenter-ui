/**
 * Theme-aware color helpers for dashboard widgets.
 * Usage: const c = widgetColors(isDark)
 */
export function widgetColors(isDark) {
  return {
    // Text
    textPrimary: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.55)',
    textSecondary: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.45)',
    textMuted: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)',
    textFaint: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)',

    // Surfaces
    surfaceHover: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
    surfaceActive: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
    surfaceSubtle: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    surfaceHighlight: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',

    // Borders
    border: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    borderLight: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    borderHover: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',

    // Tooltips
    tooltipBg: isDark ? '#1e1e2d' : '#fff',
    tooltipBorder: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)',
    tooltipText: isDark ? '#fff' : 'rgba(0,0,0,0.7)',

    // Status dot cutout
    dotBorder: isDark ? '#1e1e2d' : '#fff',
  }
}
