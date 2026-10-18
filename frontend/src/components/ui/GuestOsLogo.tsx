'use client'

import { Box } from '@mui/material'

import { getGuestOsLogo } from '@/lib/utils/osIcons'

/** The guest OS logo of /automation/templates, sized for a table row. */
export default function GuestOsLogo({ guestOs, size = 16 }: { guestOs?: string | null; size?: number }) {
  const logo = getGuestOsLogo(guestOs)
  if (!logo) return <i className="ri-question-line" style={{ fontSize: size, opacity: 0.4, flexShrink: 0 }} />
  if (!logo.tint) return <img src={logo.src} alt="" width={size} height={size} data-testid="guest-os-logo" style={{ objectFit: 'contain', flexShrink: 0 }} />
  return (
    <Box
      component="span"
      data-testid="guest-os-logo"
      data-src={logo.src}
      sx={{
        width: size, height: size, flexShrink: 0, display: 'inline-block',
        color: 'text.secondary',
        bgcolor: logo.tint,
        mask: `url(${logo.src}) center / contain no-repeat`,
        WebkitMask: `url(${logo.src}) center / contain no-repeat`,
      }}
    />
  )
}
