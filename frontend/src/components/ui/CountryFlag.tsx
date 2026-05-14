'use client'

import { Box, type BoxProps } from '@mui/material'

import { countryFlagUrl } from '@/lib/utils/countries'

interface CountryFlagProps extends Omit<BoxProps, 'component'> {

  /** ISO-3166-1 alpha-2 country code (case-insensitive). */
  code: string | null | undefined

  /** Rendered width in px. Height auto-scales with the flag's 4:3 aspect. */
  size?: number

  /** Visible alt text — defaults to the code. */
  alt?: string
}

/**
 * Renders a country flag as an `<img>` from flagcdn.com. We deliberately
 * avoid emoji rendering (`countryFlag()` from `@/lib/utils/countries`) for
 * UI elements because Chrome / Edge on Windows can't display flag emojis
 * (Microsoft removed them from Segoe UI Emoji in 2017). The image fallback
 * gives a consistent experience on every OS / browser.
 */
export function CountryFlag({ code, size = 20, alt, sx, ...rest }: CountryFlagProps) {
  const url = countryFlagUrl(code, size)

  if (!url) return null

return (
    <Box
      component="img"
      src={url}
      alt={alt ?? (code ?? '').toString().toUpperCase()}
      loading="lazy"
      sx={{
        width: size,
        height: 'auto',
        display: 'inline-block',
        verticalAlign: 'middle',
        borderRadius: 0.5,
        flexShrink: 0,
        ...sx,
      }}
      {...rest}
    />
  )
}
