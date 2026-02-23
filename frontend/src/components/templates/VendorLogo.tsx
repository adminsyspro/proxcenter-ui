'use client'

interface VendorLogoProps {
  vendor: string
  size?: number
}

export default function VendorLogo({ vendor, size = 28 }: VendorLogoProps) {
  const s = size

  switch (vendor) {
    case 'ubuntu':
      return (
        <svg viewBox="0 0 256 256" width={s} height={s}>
          <circle cx="128" cy="128" r="128" fill="#E95420" />
          <circle cx="128" cy="128" r="36" fill="none" stroke="#fff" strokeWidth="12" />
          <circle cx="128" cy="68" r="16" fill="#fff" />
          <circle cx="76" cy="160" r="16" fill="#fff" />
          <circle cx="180" cy="160" r="16" fill="#fff" />
          <line x1="128" y1="84" x2="128" y2="92" stroke="#fff" strokeWidth="10" />
          <line x1="92" y1="152" x2="98" y2="146" stroke="#fff" strokeWidth="10" />
          <line x1="164" y1="152" x2="158" y2="146" stroke="#fff" strokeWidth="10" />
        </svg>
      )

    case 'debian':
      return (
        <svg viewBox="0 0 256 256" width={s} height={s}>
          <circle cx="128" cy="128" r="128" fill="#A80030" />
          <path
            d="M148 60c-6-2-13 0-10 3 3 2 8 2 10-3zm15 7c-8-6-16-7-12-2 4 4 10 5 12 2zm-56 2c2-3-10-5-14-2 5 4 11 5 14 2zm74 15c-5-11-15-18-13-14 4 5 9 12 13 14zm-73-9c7-2 17-2 24 0 8 2 16 8 19 10-10-12-28-18-44-12-7 3-19 13-21 21 4-7 12-16 22-19zm81 25c2-12-4-22-7-24 3 8 3 18 0 25l-3 3c-2 11-9 22-18 28-15 10-31 8-42 2 12 9 34 10 48-3 8-7 13-14 16-21l3-2c2-4 3-7 3-8zm7 11c-1 17-9 28-15 33 7-7 13-18 15-33zm-85 0c-2 3-2 10 2 16-1-5-1-11-2-16zm91 14c-5 16-18 30-30 36 13-7 24-21 30-36zM96 153c5 8 13 15 25 17-10-4-19-11-25-17zm-3 6c5 11 16 21 31 24-14-5-24-14-31-24zm-3 15c8 10 16 15 27 19-12-4-21-12-27-19zm-6 34c10 2 17 1 24-2-8 1-16 1-24 2z"
            fill="#fff"
          />
        </svg>
      )

    case 'rocky':
      return (
        <svg viewBox="0 0 256 256" width={s} height={s}>
          <circle cx="128" cy="128" r="128" fill="#10B981" />
          <path
            d="M80 90l48 80 48-80z"
            fill="none"
            stroke="#fff"
            strokeWidth="16"
            strokeLinejoin="round"
          />
          <path
            d="M60 190h136"
            stroke="#fff"
            strokeWidth="16"
            strokeLinecap="round"
          />
        </svg>
      )

    case 'alma':
      return (
        <svg viewBox="0 0 256 256" width={s} height={s}>
          <circle cx="128" cy="128" r="128" fill="#0F4266" />
          <circle cx="128" cy="128" r="50" fill="none" stroke="#fff" strokeWidth="10" />
          <circle cx="128" cy="62" r="12" fill="#E5426F" />
          <circle cx="128" cy="194" r="12" fill="#FFBF00" />
          <circle cx="62" cy="128" r="12" fill="#0F8681" />
          <circle cx="194" cy="128" r="12" fill="#FD6E1A" />
        </svg>
      )

    case 'fedora':
      return (
        <svg viewBox="0 0 256 256" width={s} height={s}>
          <circle cx="128" cy="128" r="128" fill="#51A2DA" />
          <path
            d="M128 70v50h50c0-28-22-50-50-50z"
            fill="#fff"
          />
          <path
            d="M128 120H78c0 28 22 50 50 50v-50z"
            fill="#fff"
          />
          <circle cx="128" cy="120" r="18" fill="#294172" />
          <rect x="124" y="62" width="8" height="16" rx="4" fill="#fff" />
          <rect x="124" y="170" width="8" height="24" rx="4" fill="#fff" />
        </svg>
      )

    case 'opensuse':
      return (
        <svg viewBox="0 0 256 256" width={s} height={s}>
          <circle cx="128" cy="128" r="128" fill="#73BA25" />
          <path
            d="M90 100c0-21 17-38 38-38s38 17 38 38-17 38-38 38"
            fill="none"
            stroke="#fff"
            strokeWidth="14"
            strokeLinecap="round"
          />
          <circle cx="128" cy="100" r="14" fill="#fff" />
          <ellipse cx="128" cy="170" rx="45" ry="20" fill="none" stroke="#fff" strokeWidth="10" />
        </svg>
      )

    default:
      return (
        <svg viewBox="0 0 256 256" width={s} height={s}>
          <circle cx="128" cy="128" r="128" fill="#6366F1" />
          <path
            d="M128 80v96M80 128h96"
            stroke="#fff"
            strokeWidth="16"
            strokeLinecap="round"
          />
        </svg>
      )
  }
}
