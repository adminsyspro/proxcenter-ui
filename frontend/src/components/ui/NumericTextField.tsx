'use client'

import React, { useEffect, useRef, useState } from 'react'
import { TextField } from '@mui/material'

type NumericTextFieldProps = Omit<React.ComponentProps<typeof TextField>, 'value' | 'onChange'> & {
  value: number
  onChange: (value: number) => void
  fallback: number
  parse?: (raw: string) => number
  format?: (value: number) => string
  min?: number
  max?: number
}

/**
 * A numeric TextField that can actually be emptied.
 *
 * Binding `value={num}` to an onChange that coerces with `parseInt(x) || 1` makes
 * the field impossible to clear: deleting the last digit yields '', which parses
 * to NaN and snaps the state straight back to the default, so the old digit stays
 * glued in front of whatever the user types next.
 *
 * Here the input keeps its own string buffer, so an empty (or half-typed) field is
 * a valid display state. The parent only ever receives a finite number, and the
 * fallback is committed on blur, so no caller has to handle a null value.
 */
export default function NumericTextField({
  value,
  onChange,
  fallback,
  parse = Number.parseInt,
  format = String,
  min,
  max,
  onBlur,
  ...rest
}: NumericTextFieldProps) {
  const [raw, setRaw] = useState<string>(() => format(value))

  // Whether the buffer holds something the user typed. Blur must not commit
  // anything for a field that was only focused and left: with a lossy `format`
  // (state in MiB, field shown in GiB) that would write the rounding back into
  // state, turning 3000 MiB into 3072 and dirtying the form on a stray click.
  const editedRef = useRef(false)

  // Read through refs so the sync effect never re-runs just because a caller
  // passed an inline arrow: re-running it mid-keystroke would wipe the buffer.
  const parseRef = useRef(parse)
  const formatRef = useRef(format)

  // Declared before the sync effect below so the refs are already current when
  // it runs in the same commit. Written here rather than during render because
  // a render-phase ref write is unsafe under concurrent rendering.
  useEffect(() => {
    parseRef.current = parse
    formatRef.current = format
  })

  const clamp = (n: number) => {
    if (typeof min === 'number' && n < min) return min
    if (typeof max === 'number' && n > max) return max

    return n
  }

  // Follow the value the parent owns (preset chips, sliders, a reset on reopen)
  // without normalising what is currently being typed: '2.' and '1.50' both
  // already agree with the committed number and must survive as-is.
  useEffect(() => {
    setRaw(prev => {
      const prevNum = parseRef.current(prev)

      if (Number.isFinite(prevNum) && prevNum === value) return prev

      // The parent overrode what was in the box, so it is no longer an edit.
      editedRef.current = false

      return formatRef.current(value)
    })
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value

    editedRef.current = true
    setRaw(text)

    // Intermediate states on the way to a number: commit nothing, keep showing them.
    if (text === '' || text === '-' || text === '.' || text === '-.') return

    const num = parseRef.current(text)

    if (Number.isFinite(num)) onChange(num)
  }

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (!editedRef.current) {
      onBlur?.(e)

      return
    }

    const num = parseRef.current(raw)
    const next = Number.isFinite(num) ? clamp(num) : fallback

    if (next !== value) onChange(next)
    setRaw(formatRef.current(next))
    editedRef.current = false

    onBlur?.(e)
  }

  return <TextField {...rest} value={raw} onChange={handleChange} onBlur={handleBlur} />
}
