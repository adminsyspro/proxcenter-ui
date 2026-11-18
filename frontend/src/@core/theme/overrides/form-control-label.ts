import type { ThemeComponents } from '../types'

const formControlLabel: ThemeComponents = {
  MuiFormControlLabel: {
    styleOverrides: {
      root: ({ theme }) => ({
        marginInlineStart: theme.spacing(-2)
      }),
      label: {
        '&, &.Mui-disabled': {
          color: 'var(--mui-palette-text-primary)'
        },
        '&.Mui-disabled': {
          opacity: 0.45
        }
      }
    }
  }
}

export default formControlLabel
