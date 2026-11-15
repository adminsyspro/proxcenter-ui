'use client'

import { useCallback, useRef, useState } from 'react'
import type { ElementType, ReactNode } from 'react'
import { Box, Tooltip, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'

type Props = {
  text: string
  /** The tooltip content; the text itself by default. */
  title?: ReactNode
  variant?: 'body1' | 'body2' | 'caption' | 'subtitle1' | 'subtitle2' | 'h6'
  fontWeight?: number | string
  color?: string
  /** Applied to the outer wrapper: the flex sizing the caller needs (flex, minWidth, width). */
  sx?: SxProps<Theme>
  /** Struck through: the text of a row that leaves at the next apply. On the text itself, an inline block takes no decoration from its wrapper. */
  struck?: boolean
  tabIndex?: number
  'data-testid'?: string
  component?: ElementType
}

/**
 * A text cut with an ellipsis whose full text shows as a tooltip, only when it is cut. The hover
 * area is the text itself (not the stretched flex item), so the tooltip sits on the text.
 */
export default function TruncatedText({ text, title, variant, fontWeight, color, sx, struck = false, tabIndex, component = 'span', ...rest }: Readonly<Props>) {
  const ref = useRef<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)

  // Measured when the tooltip asks to open (hover or focus), so a text that fits never shows it.
  // No layout (clientWidth 0, jsdom) counts as cut.
  const onOpen = useCallback(() => {
    const el = ref.current
    if (el && (el.clientWidth === 0 || el.scrollWidth > el.clientWidth)) setOpen(true)
  }, [])
  const onClose = useCallback(() => setOpen(false), [])

  return (
    <Box component='span' sx={[{ display: 'block', minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <Tooltip title={title ?? text} open={open} onOpen={onOpen} onClose={onClose}>
        <Typography
          ref={ref}
          noWrap
          component={component}
          variant={variant}
          fontWeight={fontWeight}
          color={color}
          tabIndex={tabIndex}
          data-testid={rest['data-testid']}
          sx={{ display: 'inline-block', maxWidth: '100%', verticalAlign: 'bottom', ...(struck ? { textDecoration: 'line-through', opacity: 0.7 } : {}) }}
        >
          {text}
        </Typography>
      </Tooltip>
    </Box>
  )
}
