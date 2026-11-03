// The Remix icon wrappers render a bare <i> and copy `sx.color` into its inline
// style. A theme path such as 'success.main' is not a CSS colour there: the
// browser drops it and the icon falls back to the text colour (the context
// menus of the guest tables showed every action in white). MUI emits each
// palette entry as a CSS variable (cssVariables is on), so a theme path maps
// to its variable; anything else (#hex, rgb(), a CSS name) passes unchanged.

const PALETTE_PATH = /^(primary|secondary|error|warning|info|success|text|action|grey|common|background|divider)(\.[A-Za-z0-9]+)*$/

export function paletteColor(color: unknown): string | undefined {
  if (typeof color !== 'string' || color === '') return undefined
  if (!PALETTE_PATH.test(color)) return color

  return `var(--mui-palette-${color.replaceAll('.', '-')})`
}
