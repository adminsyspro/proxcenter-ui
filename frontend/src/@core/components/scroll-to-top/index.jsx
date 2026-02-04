'use client'

// MUI Imports
import Zoom from '@mui/material/Zoom'
import { styled } from '@mui/material/styles'
import useScrollTrigger from '@mui/material/useScrollTrigger'

const ScrollToTopStyled = styled('div')(({ theme }) => ({
  zIndex: 'var(--mui-zIndex-fab)',
  position: 'fixed',
  insetInlineEnd: theme.spacing(10),
  insetBlockEnd: theme.spacing(14)
}))

const ScrollToTop = props => {
  // Props
  const { children, className } = props

  // Hooks
  // init trigger
  const trigger = useScrollTrigger({
    threshold: 400,
    disableHysteresis: true
  })

  const handleClick = () => {
    const anchor = document.querySelector('body')

    if (anchor) {
      anchor.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <Zoom in={trigger}>
      <ScrollToTopStyled className={className} onClick={handleClick} role='presentation'>
        {children}
      </ScrollToTopStyled>
    </Zoom>
  )
}

export default ScrollToTop
