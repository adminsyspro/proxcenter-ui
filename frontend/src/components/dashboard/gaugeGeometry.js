// The gauge is drawn in a normalized 100x100 viewBox; CSS scales the SVG to
// whatever pixel size the widget slot allows (see CircularGauge.jsx). Keeping
// geometry in viewBox units gives one source of truth for the dial
// proportions, so the component never needs to know its rendered pixel size.
export const GAUGE_VIEWBOX = 100
export const GAUGE_STROKE = 8.5 // viewBox units, ~8.5% of the diameter

export function gaugeGeometry(fraction, strokeWidth = GAUGE_STROKE) {
  const f = Number.isFinite(fraction) ? Math.min(Math.max(fraction, 0), 1) : 0
  const center = GAUGE_VIEWBOX / 2
  const radius = (GAUGE_VIEWBOX - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dashoffset = circumference - f * circumference

  return { center, radius, strokeWidth, circumference, dashoffset }
}
