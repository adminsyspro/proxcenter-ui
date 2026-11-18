import type { ThemeComponents } from '../types'

const backdrop: ThemeComponents = {
  MuiBackdrop: {
    styleOverrides: {
      root: {
        '&:not(.MuiBackdrop-invisible)': {
          backgroundColor: 'var(--backdrop-color)'
        }
      }
    }
  }
}

export default backdrop
