'use client'

import { useRef } from 'react'
import { Box, IconButton, TextField, Tooltip, alpha } from '@mui/material'

/** Anchored, fixed length, no nested quantifier: S5852-safe. Mirrors src/lib/broadcast/contrast.ts. */
const HEX_SIX = /^#[0-9a-fA-F]{6}$/

/**
 * Swatch + hidden native colour input + hex field. Extracted from
 * WhiteLabelTab so the broadcast banner can reuse it instead of a third
 * copy of the same 45 lines. Uses a ref rather than a DOM id: the original
 * relied on document.getElementById with a hard-coded, hyphenated element id,
 * which cannot survive two instances on one screen.
 */
export default function ColorPicker({
  value,
  onChange,
  label,
  placeholder = '',
  fallback,
  onReset = undefined,
  // Opt-in: lets the hex field stretch instead of sitting at a fixed 160px.
  // Defaults to false so WhiteLabelTab, the original caller, is untouched.
  fullWidth = false,
}) {
  const inputRef = useRef(null)
  // `value` is free-typed and can be a transient, invalid string (e.g. "#" or
  // "red") while the administrator is still editing, before validation runs.
  // The swatch, native colour input and alpha() below must only ever see a
  // strict six-digit hex — alpha() throws on anything else. The text field
  // keeps showing the raw `value` further down so the admin can still see
  // and correct what they typed.
  const shown = HEX_SIX.test(value) ? value : fallback

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, ...(fullWidth && { width: '100%' }) }}>
      <Box sx={{ position: 'relative', flexShrink: 0 }}>
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: 1.5,
            border: '2px solid',
            borderColor: 'divider',
            bgcolor: shown,
            cursor: 'pointer',
            transition: 'box-shadow 0.2s',
            '&:hover': { boxShadow: `0 0 0 3px ${alpha(shown, 0.3)}` },
          }}
          onClick={() => inputRef.current?.click()}
        />
        <input
          ref={inputRef}
          data-testid='color-picker-native'
          type='color'
          value={shown}
          onChange={e => onChange(e.target.value)}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
        />
      </Box>
      <TextField
        size='small'
        label={label}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        sx={fullWidth ? { flex: 1, minWidth: 0 } : { width: 160 }}
        slotProps={{ htmlInput: { maxLength: 7 } }}
      />
      {onReset && value ? (
        <Tooltip title='Reset to default'>
          <IconButton size='small' aria-label='reset colour' onClick={onReset}>
            <i className='ri-refresh-line' />
          </IconButton>
        </Tooltip>
      ) : null}
    </Box>
  )
}
