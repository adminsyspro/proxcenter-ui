import type { CSSObject } from '@emotion/react'
import type { Theme } from '@mui/material/styles'

const menuRootStyles = (theme: Theme): CSSObject => {
  return {
    '& > ul > li:not(:last-of-type)': {
      marginInlineEnd: theme.spacing(0.5)
    }
  }
}

export default menuRootStyles
