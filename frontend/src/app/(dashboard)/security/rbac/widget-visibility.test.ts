import { describe, it, expect } from 'vitest'

import { widgetCategoryState, toggleWidgetCategory, toggleWidget } from './widget-visibility'

const types = ['a', 'b', 'c']

describe('widgetCategoryState', () => {
  it('reads a category with nothing hidden as fully ticked', () => {
    expect(widgetCategoryState(new Set(), types)).toEqual({ visible: 3, total: 3, checked: true, indeterminate: false })
  })

  it('reads a partly hidden category as indeterminate', () => {
    expect(widgetCategoryState(new Set(['b']), types)).toEqual({ visible: 2, total: 3, checked: false, indeterminate: true })
  })

  it('reads a fully hidden category as unticked', () => {
    expect(widgetCategoryState(new Set(types), types)).toEqual({ visible: 0, total: 3, checked: false, indeterminate: false })
  })

  it('ignores hidden widgets of other categories', () => {
    expect(widgetCategoryState(new Set(['zz']), types).visible).toBe(3)
  })
})

describe('toggleWidgetCategory', () => {
  it('hides the whole category when every widget is visible', () => {
    expect(toggleWidgetCategory(new Set(['zz']), types)).toEqual(new Set(['zz', 'a', 'b', 'c']))
  })

  it('shows the whole category when some widgets are hidden', () => {
    expect(toggleWidgetCategory(new Set(['b', 'zz']), types)).toEqual(new Set(['zz']))
  })

  it('shows the whole category when all widgets are hidden', () => {
    expect(toggleWidgetCategory(new Set(types), types)).toEqual(new Set())
  })

  it('does not mutate its input', () => {
    const hidden = new Set(['b'])

    toggleWidgetCategory(hidden, types)
    expect(hidden).toEqual(new Set(['b']))
  })
})

describe('toggleWidget', () => {
  it('hides a visible widget and shows a hidden one', () => {
    const hidden = new Set(['a'])

    expect(toggleWidget(hidden, 'b')).toEqual(new Set(['a', 'b']))
    expect(toggleWidget(hidden, 'a')).toEqual(new Set())
    expect(hidden).toEqual(new Set(['a']))
  })
})
