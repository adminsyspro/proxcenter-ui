// MUI Imports
import MuiTabList from '@mui/lab/TabList'
import { styled } from '@mui/material/styles'

const TabList = styled(MuiTabList)(({ color, pill, theme, orientation }) => ({
  ...(pill === 'true' && {
    minHeight: 38,
    ...(orientation === 'vertical'
      ? {
          borderInlineEnd: 0
        }
      : {
          borderBlockEnd: 0
        }),
    '&, & .MuiTabs-scroller': {
      ...(orientation === 'vertical' && {
        boxSizing: 'content-box'
      }),
      margin: `${theme.spacing(-1, -1, -1.5, -1)} !important`,
      padding: theme.spacing(1, 1, 1.5, 1)
    },
    '& .MuiTabs-indicator': {
      display: 'none'
    },
    '& .MuiTabs-flexContainer': {
      gap: theme.spacing(1)
    },
    '& .Mui-selected': {
      backgroundColor: `var(--mui-palette-${color}-main) !important`,
      color: `var(--mui-palette-${color}-contrastText) !important`,
      boxShadow: 'var(--mui-customShadows-xs)'
    },
    '& .MuiTab-root': {
      minHeight: 38,
      padding: theme.spacing(2, 5.5),
      borderRadius: 'var(--mui-shape-borderRadius)',
      '&:hover': {
        border: 0,
        backgroundColor: `var(--mui-palette-${color}-lightOpacity)`,
        color: `var(--mui-palette-${color}-main)`,
        ...(orientation === 'vertical'
          ? {
              paddingInlineEnd: theme.spacing(5.5)
            }
          : {
              paddingBlockEnd: theme.spacing(2)
            })
      }
    }
  })
}))

const CustomTabList = props => {
  // Props
  const { color = 'primary', ...rest } = props

  return <TabList color={color} {...rest} />
}

export default CustomTabList
