/*
   jsdom has no layout: what a test can check is the CSS the component asked
   for. `lgStyle` collects the declarations that apply to an element from the
   `lg` media rules (min-width 1200 px) of the emotion style sheets.
*/

const LG_QUERY = /min-width:\s*1200px/

function declarations(rule: CSSStyleRule): Record<string, string> {
  const out: Record<string, string> = {}

  for (let i = 0; i < rule.style.length; i++) {
    const name = rule.style.item(i)

    out[name] = rule.style.getPropertyValue(name)
  }

  return out
}

function collect(rules: CSSRuleList, el: Element, inLg: boolean, out: Record<string, string>) {
  for (const rule of Array.from(rules)) {
    if ('media' in rule && 'cssRules' in rule) {
      const media = rule as CSSMediaRule

      collect(media.cssRules, el, inLg || LG_QUERY.test(media.conditionText ?? media.media.mediaText), out)
    } else if (inLg && 'selectorText' in rule) {
      const style = rule as CSSStyleRule

      if (style.selectorText.split(',').some(sel => { try { return el.matches(sel.trim()) } catch { return false } })) {
        Object.assign(out, declarations(style))
      }
    }
  }
}

/** Declarations that apply to `el` from `lg` up (later rules win, as in the cascade). */
export function lgStyle(el: Element): Record<string, string> {
  const out: Record<string, string> = {}

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      collect(sheet.cssRules, el, false, out)
    } catch {
      // Cross-origin sheet: nothing to read.
    }
  }

  return out
}

/** A node of the fill chain: it grows into the free height and lays its children out in a column. */
export const FILL_COLUMN = { flex: '1 1 auto', 'min-height': '0px', display: 'flex', 'flex-direction': 'column' }
