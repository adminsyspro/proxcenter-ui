import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { deepmerge } from '@mui/utils'
import { ThemeProvider, createTheme, lighten, darken } from '@mui/material/styles'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

// `@core/theme` pulls a Google font through the Next build pipeline at import
// time; only the palette and the component overrides matter here.
vi.mock('next/font/google', () => ({
  Inter: () => ({ style: { fontFamily: 'Inter' } })
}))

import defaultCoreTheme from '@core/theme'
import { INHERIT_ON_PRIMARY_SX } from './onPrimary'
import { commandPaletteRowSx } from '@/components/layout/shared/commandPaletteRowSx'

// The RTL harness has no automatic cleanup in this suite.
afterEach(cleanup)

// The white-label yellow from issue #460.
const PRIMARY = '#FFD200'

// Same construction as components/theme/index.jsx.
const theme = createTheme(
  deepmerge(defaultCoreTheme({ skin: 'default' } as any, 'light', 'ltr'), {
    colorSchemes: {
      light: { palette: { primary: { main: PRIMARY, light: lighten(PRIMARY, 0.2), dark: darken(PRIMARY, 0.1) } } },
      dark: { palette: { primary: { main: PRIMARY, light: lighten(PRIMARY, 0.2), dark: darken(PRIMARY, 0.1) } } }
    },
    cssVariables: { colorSchemeSelector: 'data' }
  }) as any
)

const colorOf = (element: HTMLElement) => getComputedStyle(element).color.toLowerCase()

const renderOnPrimary = (sx: object, label: React.ReactNode) =>
  render(
    <ThemeProvider theme={theme}>
      <Box sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', ...sx }}>{label}</Box>
    </ThemeProvider>
  )

describe('INHERIT_ON_PRIMARY_SX', () => {
  it('reproduces the defect: without it a Typography ignores the surface colour', () => {
    // Every variant gets an explicit colour from @core/theme/overrides/
    // typography.js, so the label keeps text.secondary on a primary-filled
    // row. That is what makes a light white-label primary unreadable, while
    // the plain <i> icon next to it flips correctly.
    const { getByText } = renderOnPrimary({}, <Typography variant='body2'>Dashboard</Typography>)

    expect(colorOf(getByText('Dashboard'))).toContain('--mui-palette-text-secondary')
  })

  it('makes body text follow primary.contrastText', () => {
    const { getByText } = renderOnPrimary(
      INHERIT_ON_PRIMARY_SX,
      <Typography variant='body2'>Dashboard</Typography>
    )

    expect(colorOf(getByText('Dashboard'))).toContain('--mui-palette-primary-contrasttext')
  })

  it('also covers caption, the lowest-contrast variant', () => {
    const { getByText } = renderOnPrimary(
      INHERIT_ON_PRIMARY_SX,
      <Typography variant='caption'>vmid 100</Typography>
    )

    expect(colorOf(getByText('vmid 100'))).toContain('--mui-palette-primary-contrasttext')
  })

  it('overrides a Typography that asks for a colour of its own', () => {
    const { getByText } = renderOnPrimary(
      INHERIT_ON_PRIMARY_SX,
      <Typography variant='body2' color='text.secondary'>
        pve1
      </Typography>
    )

    expect(colorOf(getByText('pve1'))).toContain('--mui-palette-primary-contrasttext')
  })
})

describe('command palette row', () => {
  it('keeps the highlighted row on its usual label colour: the selection tint is neutral, so no contrast override applies', () => {
    const { getByText } = render(
      <ThemeProvider theme={theme}>
        <Box sx={commandPaletteRowSx(true)}>
          <i className='ri-dashboard-line' />
          <Typography variant='body2'>Dashboard</Typography>
        </Box>
      </ThemeProvider>
    )

    expect(colorOf(getByText('Dashboard'))).toContain('--mui-palette-text-secondary')
    expect(colorOf(getByText('Dashboard'))).not.toContain('--mui-palette-primary-contrasttext')
  })

  it('leaves an idle row with its usual secondary label', () => {
    const { getByText } = render(
      <ThemeProvider theme={theme}>
        <Box sx={commandPaletteRowSx(false)}>
          <Typography variant='body2'>Inventory</Typography>
        </Box>
      </ThemeProvider>
    )

    expect(colorOf(getByText('Inventory'))).toContain('--mui-palette-text-secondary')
  })
})
