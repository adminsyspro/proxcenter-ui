// Layout of the node names under the DRS "CPU and RAM per node" bar chart.
// With many nodes, or long node names, the names no longer fit side by side
// under their bars: they are then tilted, and shortened past a few characters.
// When even tilted names would collide, they are hidden (the bar tooltip
// still names the node).

export const NODE_AXIS_FONT_SIZE = 10
export const NODE_AXIS_ANGLE = -45
const HORIZONTAL_AXIS_HEIGHT = 30
const TICK_GAP = 6
const MAX_TILTED_LABEL_WIDTH = 120
const ELLIPSIS = '…'

export type NodeAxisLayout =
  | { mode: 'horizontal'; height: number }
  | { mode: 'tilted'; height: number; maxLabelWidth: number; leftPad: number }
  | { mode: 'hidden'; height: number }

/**
 * Picks how the node names fit under the bars.
 * `labelWidths` are the rendered widths (px) of each name, `plotWidth` the
 * width of the area holding the bars.
 */
export function computeNodeAxisLayout(labelWidths: number[], plotWidth: number, yAxisWidth = 0): NodeAxisLayout {
  if (labelWidths.length === 0 || plotWidth <= 0) return { mode: 'horizontal', height: HORIZONTAL_AXIS_HEIGHT }

  const slot = plotWidth / labelWidths.length
  const longest = Math.max(...labelWidths)

  if (longest + TICK_GAP <= slot) return { mode: 'horizontal', height: HORIZONTAL_AXIS_HEIGHT }

  // Tilted at 45°, two neighbouring names are slot * sin(45°) apart: below
  // the text height plus a small gap, they overlap.
  const sin = Math.sin((Math.abs(NODE_AXIS_ANGLE) * Math.PI) / 180)

  if (slot * sin < NODE_AXIS_FONT_SIZE + 2) return { mode: 'hidden', height: 4 }

  const maxLabelWidth = Math.min(longest, MAX_TILTED_LABEL_WIDTH)
  const height = Math.ceil(maxLabelWidth * sin + NODE_AXIS_FONT_SIZE * sin + 10)

  // The first name runs left of its bar: pad the chart so it is not cut off
  const leftPad = Math.max(0, Math.ceil(maxLabelWidth * sin - yAxisWidth - slot / 2))

  return { mode: 'tilted', height, maxLabelWidth, leftPad }
}

/**
 * Shortens `text` in its middle with an ellipsis so that `measure(text)` stays
 * within `maxWidth`. Node names of a cluster usually share a prefix and differ
 * by their end (PROXMOX-RBX1PRD1, PROXMOX-RBX1PRD2), so both ends are kept.
 */
export function truncateToWidth(text: string, maxWidth: number, measure: (s: string) => number): string {
  if (measure(text) <= maxWidth) return text
  const shorten = (keep: number) => text.slice(0, Math.ceil(keep / 2)) + ELLIPSIS + text.slice(text.length - Math.floor(keep / 2))
  let keep = text.length - 1

  while (keep > 0 && measure(shorten(keep)) > maxWidth) keep--

  return keep > 0 ? shorten(keep) : ELLIPSIS
}

/**
 * Builds a text measurer for the given font. Falls back to an average glyph
 * width when no canvas is available (server render, tests).
 */
export function createTextMeasurer(font: string): (s: string) => number {
  const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext?.('2d') : null

  if (!ctx) return (s: string) => s.length * NODE_AXIS_FONT_SIZE * 0.62
  ctx.font = font

  return (s: string) => ctx.measureText(s).width
}
