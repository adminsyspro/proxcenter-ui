import type { Skin } from '@configs/themeConfig'
import type { ThemeComponents } from '../types'

const popover = (skin: Skin): ThemeComponents => ({
  MuiPopover: {
    styleOverrides: {
      paper: {
        ...(skin === 'bordered'
          ? { boxShadow: 'none', border: '1px solid var(--mui-palette-divider)' }
          : {
              boxShadow: 'var(--mui-customShadows-sm)'
            })
      }
    }
  }
})

export default popover
