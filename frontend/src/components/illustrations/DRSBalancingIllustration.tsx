'use client'

import { useTheme } from '@mui/material/styles'

export default function DRSBalancingIllustration() {
  const theme = useTheme()
  const primary = theme.palette.primary.main
  const muted = theme.palette.text.secondary

  return (
    <svg width="240" height="160" viewBox="0 0 240 160" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Node 1 — left */}
      <rect x="16" y="30" width="52" height="64" rx="6" fill={muted} fillOpacity={0.07} stroke={muted} strokeOpacity={0.18} strokeWidth="1.5" />
      <rect x="24" y="42" width="8" height="8" rx="1.5" fill={primary} fillOpacity={0.6} />
      <rect x="24" y="54" width="8" height="8" rx="1.5" fill={primary} fillOpacity={0.4} />
      <rect x="24" y="66" width="8" height="8" rx="1.5" fill={primary} fillOpacity={0.2} />
      {/* Load bars node 1 — high load (80%) */}
      <rect x="38" y="44" width="22" height="4" rx="2" fill={muted} fillOpacity={0.1} />
      <rect x="38" y="44" width="18" height="4" rx="2" fill={primary} fillOpacity={0.8} />
      <rect x="38" y="56" width="22" height="4" rx="2" fill={muted} fillOpacity={0.1} />
      <rect x="38" y="56" width="15" height="4" rx="2" fill={primary} fillOpacity={0.6} />
      <rect x="38" y="68" width="22" height="4" rx="2" fill={muted} fillOpacity={0.1} />
      <rect x="38" y="68" width="20" height="4" rx="2" fill={primary} fillOpacity={0.9} />
      {/* Label */}
      <text x="42" y="86" textAnchor="middle" fontSize="8" fontWeight="600" fill={muted} fillOpacity={0.5} fontFamily="Inter, sans-serif">Node A</text>

      {/* Node 2 — center */}
      <rect x="94" y="30" width="52" height="64" rx="6" fill={muted} fillOpacity={0.07} stroke={primary} strokeOpacity={0.35} strokeWidth="1.5" />
      <rect x="102" y="42" width="8" height="8" rx="1.5" fill={primary} fillOpacity={0.6} />
      <rect x="102" y="54" width="8" height="8" rx="1.5" fill={primary} fillOpacity={0.4} />
      <rect x="102" y="66" width="8" height="8" rx="1.5" fill={primary} fillOpacity={0.2} />
      {/* Load bars node 2 — balanced (50%) */}
      <rect x="116" y="44" width="22" height="4" rx="2" fill={muted} fillOpacity={0.1} />
      <rect x="116" y="44" width="11" height="4" rx="2" fill={primary} fillOpacity={0.7} />
      <rect x="116" y="56" width="22" height="4" rx="2" fill={muted} fillOpacity={0.1} />
      <rect x="116" y="56" width="12" height="4" rx="2" fill={primary} fillOpacity={0.6} />
      <rect x="116" y="68" width="22" height="4" rx="2" fill={muted} fillOpacity={0.1} />
      <rect x="116" y="68" width="10" height="4" rx="2" fill={primary} fillOpacity={0.5} />
      {/* Label */}
      <text x="120" y="86" textAnchor="middle" fontSize="8" fontWeight="600" fill={muted} fillOpacity={0.5} fontFamily="Inter, sans-serif">Node B</text>

      {/* Node 3 — right */}
      <rect x="172" y="30" width="52" height="64" rx="6" fill={muted} fillOpacity={0.07} stroke={muted} strokeOpacity={0.18} strokeWidth="1.5" />
      <rect x="180" y="42" width="8" height="8" rx="1.5" fill={primary} fillOpacity={0.6} />
      <rect x="180" y="54" width="8" height="8" rx="1.5" fill={primary} fillOpacity={0.4} />
      <rect x="180" y="66" width="8" height="8" rx="1.5" fill={primary} fillOpacity={0.2} />
      {/* Load bars node 3 — low load (30%) */}
      <rect x="194" y="44" width="22" height="4" rx="2" fill={muted} fillOpacity={0.1} />
      <rect x="194" y="44" width="7" height="4" rx="2" fill={primary} fillOpacity={0.5} />
      <rect x="194" y="56" width="22" height="4" rx="2" fill={muted} fillOpacity={0.1} />
      <rect x="194" y="56" width="5" height="4" rx="2" fill={primary} fillOpacity={0.4} />
      <rect x="194" y="68" width="22" height="4" rx="2" fill={muted} fillOpacity={0.1} />
      <rect x="194" y="68" width="8" height="4" rx="2" fill={primary} fillOpacity={0.5} />
      {/* Label */}
      <text x="198" y="86" textAnchor="middle" fontSize="8" fontWeight="600" fill={muted} fillOpacity={0.5} fontFamily="Inter, sans-serif">Node C</text>

      {/* Curved arrow: Node A → Node B */}
      <path
        d="M70 50 Q82 28 92 50"
        stroke={primary}
        strokeOpacity={0.55}
        strokeWidth="1.5"
        fill="none"
        strokeDasharray="4 3"
      />
      <polygon points="92,50 87,44 89,51" fill={primary} fillOpacity={0.55} />

      {/* Curved arrow: Node B → Node C */}
      <path
        d="M148 50 Q160 28 170 50"
        stroke={primary}
        strokeOpacity={0.55}
        strokeWidth="1.5"
        fill="none"
        strokeDasharray="4 3"
      />
      <polygon points="170,50 165,44 167,51" fill={primary} fillOpacity={0.55} />

      {/* Curved arrow: Node C → Node A (bottom, reverse) */}
      <path
        d="M172 80 Q120 120 68 80"
        stroke={primary}
        strokeOpacity={0.3}
        strokeWidth="1.5"
        fill="none"
        strokeDasharray="4 3"
      />
      <polygon points="68,80 74,77 71,84" fill={primary} fillOpacity={0.3} />

      {/* Balance icon center-bottom */}
      <circle cx="120" cy="138" r="12" fill={primary} fillOpacity={0.1} />
      <path
        d="M114 140 L120 132 L126 140 M114 140 L116 136 M126 140 L124 136"
        stroke={primary}
        strokeOpacity={0.6}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="120" y1="132" x2="120" y2="145" stroke={primary} strokeOpacity={0.6} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="115" y1="145" x2="125" y2="145" stroke={primary} strokeOpacity={0.6} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
