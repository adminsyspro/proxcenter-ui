// React Imports
import React from 'react'
import type { CSSObject, Theme } from '@mui/material/styles'

import type { ThemeComponents } from '../types'

const SelectIcon = () => {
  return <i className='ri-arrow-down-s-line' />
}

const iconStyles = (theme: Pick<Theme, 'transitions'>): CSSObject => ({
  userSelect: 'none',
  display: 'inline-block',
  fill: 'currentColor',
  flexShrink: 0,
  transition: theme.transitions.create('fill', {
    duration: theme.transitions.duration.shorter
  }),
  fontSize: '1.25rem',
  position: 'absolute',
  right: '1rem',
  top: 'calc(50% - 0.5em)',
  pointerEvents: 'none'
})

const select: ThemeComponents = {
  MuiSelect: {
    defaultProps: {
      IconComponent: SelectIcon
    },
    styleOverrides: {
      select: ({ theme, ownerState }) => ({
        ...(ownerState.variant === 'outlined' && {
          minHeight: '1.5em'
        }),
        '&[aria-expanded="true"] ~ i, &[aria-expanded="true"] ~ svg': {
          transform: 'rotate(180deg)'
        },
        '& ~ i, & ~ svg': iconStyles(theme),
        '&.MuiInputBase-inputSizeSmall': {
          '& ~ i, & ~ svg': {
            height: '1.375rem',
            width: '1.375rem'
          }
        },
        '&:not(aria-label="Without label") ~ .MuiOutlinedInput-notchedOutline > legend > span': {
          paddingInline: '5px'
        }
      })
    }
  },
  MuiNativeSelect: {
    styleOverrides: {
      select: ({ theme }) => ({
        '& + i, & + svg': iconStyles(theme)
      })
    }
  }
}

export default select
