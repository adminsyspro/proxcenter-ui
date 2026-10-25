'use client'

import { Box, InputAdornment, Tooltip } from '@mui/material'

/**
 * The info bubble of a field whose name alone can be misread. Inside the field
 * (end adornment) rather than in its label: an empty field's label lets no
 * pointer through, so a hint there could not be hovered.
 */
export function FieldHint({ text }: { text: string }) {
  return (
    <Tooltip arrow title={text} slotProps={{ tooltip: { sx: { maxWidth: 360 } } }}>
      <Box component='span' aria-label={text} sx={{ display: 'inline-flex', alignItems: 'center', cursor: 'help' }}>
        <i className='ri-information-line' style={{ fontSize: 16, opacity: 0.6 }} />
      </Box>
    </Tooltip>
  )
}

/** `slotProps` of a TextField carrying a FieldHint. */
export function hintSlotProps(text: string) {
  return { input: { endAdornment: <InputAdornment position='end'><FieldHint text={text} /></InputAdornment> } }
}
