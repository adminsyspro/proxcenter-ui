// Widget visibility of a role. The role stores a denylist
// (`widget_overrides.hidden`), but the dialog shows a ticked box for a VISIBLE
// widget, the same reading as the permission boxes above it: ticking every
// box in the dialog must never hide the whole dashboard.

export interface WidgetCategoryState {
  visible: number
  total: number
  checked: boolean
  indeterminate: boolean
}

export function widgetCategoryState(hidden: ReadonlySet<string>, types: readonly string[]): WidgetCategoryState {
  const visible = types.filter(t => !hidden.has(t)).length

  return {
    visible,
    total: types.length,
    checked: visible === types.length,
    indeterminate: visible > 0 && visible < types.length,
  }
}

/** Header box: a fully visible category is hidden, any other state shows it all. */
export function toggleWidgetCategory(hidden: ReadonlySet<string>, types: readonly string[]): Set<string> {
  const next = new Set(hidden)
  const allVisible = types.every(t => !hidden.has(t))

  types.forEach(t => (allVisible ? next.add(t) : next.delete(t)))

  return next
}

export function toggleWidget(hidden: ReadonlySet<string>, type: string): Set<string> {
  const next = new Set(hidden)

  if (next.has(type)) next.delete(type)
  else next.add(type)

  return next
}
