'use client'

import { useTheme } from '@mui/material/styles'

export default function SiteRecoveryIllustration() {
  const theme = useTheme()
  const primary = theme.palette.primary.main
  const success = theme.palette.success.main
  const muted = theme.palette.text.secondary

  return (
    <svg width="240" height="160" viewBox="0 0 240 160" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Source site rack — left */}
      <rect x="16" y="24" width="72" height="96" rx="6" fill={muted} fillOpacity={0.07} stroke={muted} strokeOpacity={0.18} strokeWidth="1.5" />
      {/* Label "SOURCE" */}
      <text x="52" y="18" textAnchor="middle" fontSize="7.5" fontWeight="700" fill={muted} fillOpacity={0.4} fontFamily="Inter, sans-serif" letterSpacing="0.5">SOURCE</text>

      {/* Server units in source rack */}
      <rect x="24" y="34" width="56" height="14" rx="3" fill={primary} fillOpacity={0.08} stroke={primary} strokeOpacity={0.2} strokeWidth="1" />
      <circle cx="32" cy="41" r="2.5" fill={primary} fillOpacity={0.5} />
      <rect x="38" y="39" width="18" height="2.5" rx="1" fill={primary} fillOpacity={0.25} />
      <circle cx="72" cy="41" r="1.5" fill={success} fillOpacity={0.7} />

      <rect x="24" y="52" width="56" height="14" rx="3" fill={primary} fillOpacity={0.08} stroke={primary} strokeOpacity={0.2} strokeWidth="1" />
      <circle cx="32" cy="59" r="2.5" fill={primary} fillOpacity={0.5} />
      <rect x="38" y="57" width="18" height="2.5" rx="1" fill={primary} fillOpacity={0.25} />
      <circle cx="72" cy="59" r="1.5" fill={success} fillOpacity={0.7} />

      <rect x="24" y="70" width="56" height="14" rx="3" fill={primary} fillOpacity={0.08} stroke={primary} strokeOpacity={0.2} strokeWidth="1" />
      <circle cx="32" cy="77" r="2.5" fill={primary} fillOpacity={0.5} />
      <rect x="38" y="75" width="18" height="2.5" rx="1" fill={primary} fillOpacity={0.25} />
      <circle cx="72" cy="77" r="1.5" fill={success} fillOpacity={0.7} />

      <rect x="24" y="88" width="56" height="14" rx="3" fill={primary} fillOpacity={0.05} stroke={muted} strokeOpacity={0.12} strokeWidth="1" />
      <circle cx="32" cy="95" r="2.5" fill={muted} fillOpacity={0.2} />
      <rect x="38" y="93" width="18" height="2.5" rx="1" fill={muted} fillOpacity={0.12} />
      <circle cx="72" cy="95" r="1.5" fill={muted} fillOpacity={0.2} />

      {/* Target site rack — right */}
      <rect x="152" y="24" width="72" height="96" rx="6" fill={success} fillOpacity={0.04} stroke={success} strokeOpacity={0.2} strokeWidth="1.5" />
      {/* Label "TARGET" */}
      <text x="188" y="18" textAnchor="middle" fontSize="7.5" fontWeight="700" fill={success} fillOpacity={0.5} fontFamily="Inter, sans-serif" letterSpacing="0.5">TARGET</text>

      {/* Server units in target rack */}
      <rect x="160" y="34" width="56" height="14" rx="3" fill={success} fillOpacity={0.06} stroke={success} strokeOpacity={0.15} strokeWidth="1" />
      <circle cx="168" cy="41" r="2.5" fill={success} fillOpacity={0.4} />
      <rect x="174" y="39" width="18" height="2.5" rx="1" fill={success} fillOpacity={0.2} />
      <circle cx="208" cy="41" r="1.5" fill={success} fillOpacity={0.5} />

      <rect x="160" y="52" width="56" height="14" rx="3" fill={success} fillOpacity={0.06} stroke={success} strokeOpacity={0.15} strokeWidth="1" />
      <circle cx="168" cy="59" r="2.5" fill={success} fillOpacity={0.4} />
      <rect x="174" y="57" width="18" height="2.5" rx="1" fill={success} fillOpacity={0.2} />
      <circle cx="208" cy="59" r="1.5" fill={success} fillOpacity={0.5} />

      <rect x="160" y="70" width="56" height="14" rx="3" fill={success} fillOpacity={0.06} stroke={success} strokeOpacity={0.15} strokeWidth="1" />
      <circle cx="168" cy="77" r="2.5" fill={success} fillOpacity={0.4} />
      <rect x="174" y="75" width="18" height="2.5" rx="1" fill={success} fillOpacity={0.2} />
      <circle cx="208" cy="77" r="1.5" fill={success} fillOpacity={0.5} />

      <rect x="160" y="88" width="56" height="14" rx="3" fill={success} fillOpacity={0.03} stroke={muted} strokeOpacity={0.08} strokeWidth="1" />
      <circle cx="168" cy="95" r="2.5" fill={muted} fillOpacity={0.15} />
      <rect x="174" y="93" width="18" height="2.5" rx="1" fill={muted} fillOpacity={0.08} />
      <circle cx="208" cy="95" r="1.5" fill={muted} fillOpacity={0.15} />

      {/* Data flow arrows — three dashed lines between racks */}
      <line x1="90" y1="41" x2="148" y2="41" stroke={primary} strokeOpacity={0.35} strokeWidth="1.5" strokeDasharray="5 4" />
      <polygon points="148,41 143,38 143,44" fill={primary} fillOpacity={0.35} />

      <line x1="90" y1="59" x2="148" y2="59" stroke={primary} strokeOpacity={0.5} strokeWidth="1.5" strokeDasharray="5 4" />
      <polygon points="148,59 143,56 143,62" fill={primary} fillOpacity={0.5} />

      <line x1="90" y1="77" x2="148" y2="77" stroke={primary} strokeOpacity={0.35} strokeWidth="1.5" strokeDasharray="5 4" />
      <polygon points="148,77 143,74 143,80" fill={primary} fillOpacity={0.35} />

      {/* "DR" shield badge on target site */}
      <rect x="172" y="104" width="32" height="20" rx="4" fill={success} fillOpacity={0.12} stroke={success} strokeOpacity={0.3} strokeWidth="1" />
      {/* Shield icon */}
      <path
        d="M182 109 L182 117 Q182 120 188 122 Q194 120 194 117 L194 109 Z"
        fill={success}
        fillOpacity={0.15}
        stroke={success}
        strokeOpacity={0.5}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <text x="188" y="118" textAnchor="middle" fontSize="5.5" fontWeight="800" fill={success} fillOpacity={0.7} fontFamily="Inter, sans-serif">DR</text>

      {/* Replication label */}
      <text x="120" y="144" textAnchor="middle" fontSize="7.5" fontWeight="600" fill={muted} fillOpacity={0.4} fontFamily="Inter, sans-serif">Replication</text>
      {/* Small sync icon */}
      <path
        d="M108 140 Q104 136 108 132 M112 132 Q116 136 112 140"
        stroke={primary}
        strokeOpacity={0.3}
        strokeWidth="1"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  )
}
