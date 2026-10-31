'use client'

import { Box, Tooltip } from '@mui/material'

/**
 * The help of a notification category: what it notifies, on hover or focus.
 * It sits in the label of the category switch, so a click on it must not
 * toggle the switch.
 */
export default function NotificationCategoryHelp({ text }: Readonly<{ text: string }>) {
  return (
    <Tooltip title={text}>
      <Box component='span' tabIndex={0} aria-label={text} onClick={e => e.preventDefault()} sx={{ display: 'flex', opacity: 0.6, cursor: 'help' }}>
        <i className='ri-information-line' aria-hidden='true' />
      </Box>
    </Tooltip>
  )
}
