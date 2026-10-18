'use client'

// The expanded view of one firewall log line (ui#1114): what decided, then the
// packet's fields read off the raw line, one per row, in cards by subject
// (flow, interfaces, IP/TCP header), and the raw line itself to copy.

import { Fragment, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import { Box, IconButton, Tooltip, Typography, useTheme, alpha } from '@mui/material'

import { GuestGlyph, NodeGlyph } from '@/components/automation/drs/glyphs'
import { logLevelName, parseFirewallLogLine } from '@/lib/firewall/logParse'

import type { FirewallLogRow } from '@/lib/api/firewall'
import type { LogGuestInfo } from './FirewallLogView'

const MONO = '"JetBrains Mono", ui-monospace, monospace'

/** The packet fields by card, in reading order; any other field joins the header's. */
const FLOW_FIELDS = ['SRC', 'DST', 'PROTO', 'SPT', 'DPT', 'TYPE', 'CODE']
const IFACE_FIELDS = ['IN', 'OUT', 'PHYSIN', 'PHYSOUT', 'MAC']
const HEADER_FIELDS = ['LEN', 'TTL', 'ID', 'TOS', 'PREC', 'SEQ', 'ACK', 'WINDOW', 'RES', 'URGP']
const KNOWN_FIELDS = new Set([...FLOW_FIELDS, ...IFACE_FIELDS, ...HEADER_FIELDS])

const FIELD_ICONS: Record<string, string> = {
  SRC: 'ri-map-pin-line', DST: 'ri-focus-3-line', PROTO: 'ri-exchange-line', SPT: 'ri-door-open-line', DPT: 'ri-door-closed-line',
  TYPE: 'ri-pulse-line', CODE: 'ri-hashtag',
  IN: 'ri-login-box-line', OUT: 'ri-logout-box-r-line', PHYSIN: 'ri-plug-line', PHYSOUT: 'ri-plug-2-line', MAC: 'ri-fingerprint-line',
  LEN: 'ri-ruler-line', TTL: 'ri-hourglass-line', ID: 'ri-hashtag', TOS: 'ri-equalizer-line', PREC: 'ri-sort-desc',
  SEQ: 'ri-list-ordered', ACK: 'ri-check-double-line', WINDOW: 'ri-window-line', RES: 'ri-lock-line', URGP: 'ri-alarm-warning-line',
}

interface Item {
  key: string
  icon: ReactNode
  label: string
  /** The field's name on the raw line, shown when the label differs. */
  code?: string
  value: ReactNode
  mono?: boolean
}

interface Card {
  key: string
  icon: string
  title: string
  items: Item[]
}

interface Props {
  row: FirewallLogRow
  guest?: LogGuestInfo
  decidedBy: string
  actionColor: string
  actionIcon: string
}

const iconOf = (className: string, color?: string) => <i className={className} style={{ fontSize: 14, opacity: color ? 1 : 0.6, color }} />

export default function LogLineDetails({ row: r, guest, decidedBy, actionColor, actionIcon }: Props) {
  const theme = useTheme()
  const t = useTranslations()
  const locale = useLocale()
  const dark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper
  const [copied, setCopied] = useState(false)

  const p = parseFirewallLogLine(r.raw)
  const fields = p?.fields || {}

  const field = (k: string): Item => {
    const label = KNOWN_FIELDS.has(k) ? t(`firewallLog.fields.${k}`) : k

    return { key: k, icon: iconOf(FIELD_ICONS[k] || 'ri-more-line'), label, code: label === k ? undefined : k, value: fields[k] || '—', mono: true }
  }
  const present = (keys: string[]) => keys.filter(k => k in fields).map(field)
  const others = Object.keys(fields).filter(k => !KNOWN_FIELDS.has(k)).map(field)

  const cards: Card[] = [
    {
      key: 'decision',
      icon: 'ri-scales-3-line',
      title: t('firewallLog.detailDecision'),
      items: [
        {
          key: 'action',
          icon: iconOf(actionIcon, actionColor),
          label: t('firewallLog.action'),
          value: <Box component="span" sx={{ color: actionColor, fontWeight: 700 }}>{r.action || t('firewallLog.unknownAction')}{r.actionInferred && ' ≈'}</Box>,
        },
        { key: 'decidedBy', icon: iconOf('ri-shield-check-line'), label: t('firewallLog.decidedBy'), value: decidedBy },
        { key: 'chain', icon: iconOf('ri-links-line'), label: t('firewallLog.chain'), value: r.chain, mono: true },
        // A node whose log was read is online.
        { key: 'node', icon: <NodeGlyph status="online" dark={dark} dotBorder={dotBorder} />, label: t('firewallLog.node'), value: r.node },
        ...(r.vmid === undefined ? [] : [{
          key: 'guest',
          icon: <GuestGlyph type={guest?.type} status={guest?.status} dotBorder={dotBorder} />,
          label: t('firewallLog.guest'),
          value: `${guest?.name || t('firewallLog.unknownGuest')} #${r.vmid}`,
        }]),
        { key: 'level', icon: iconOf('ri-file-list-3-line'), label: t('firewallLog.logLevel'), value: logLevelName(r.level) ?? String(r.level), mono: true },
        { key: 'time', icon: iconOf('ri-time-line'), label: t('firewallLog.time'), value: new Date(r.ts).toLocaleString(locale) },
      ],
    },
    {
      key: 'flow',
      icon: 'ri-route-line',
      title: t('firewallLog.detailFlow'),
      items: [
        ...present(FLOW_FIELDS),
        ...(p?.flags.length ? [{ key: 'flags', icon: iconOf('ri-flag-line'), label: t('firewallLog.fields.flags'), value: p.flags.join(' '), mono: true }] : []),
      ],
    },
    { key: 'iface', icon: 'ri-router-line', title: t('firewallLog.detailInterfaces'), items: present(IFACE_FIELDS) },
    { key: 'header', icon: 'ri-stack-line', title: t('firewallLog.detailHeader'), items: [...present(HEADER_FIELDS), ...others] },
  ].filter(c => c.items.length > 0)

  const cardSx = { border: `1px solid ${theme.palette.divider}`, borderRadius: 1.5, overflow: 'hidden', bgcolor: 'background.paper', minWidth: 0 }

  const cardHeader = (icon: string, title: string, extra?: ReactNode) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, borderBottom: `1px solid ${theme.palette.divider}`, bgcolor: alpha(theme.palette.text.primary, 0.03) }}>
      <i className={icon} style={{ fontSize: 15, color: theme.palette.primary.main }} />
      <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary' }}>{title}</Typography>
      {extra && <Box sx={{ ml: 'auto' }}>{extra}</Box>}
    </Box>
  )

  const copyRaw = () => {
    void navigator.clipboard?.writeText(r.raw).then(() => setCopied(true), () => setCopied(false))
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' }, gap: 1.5, alignItems: 'stretch' }}>
        {cards.map(card => (
          <Box key={card.key} sx={cardSx}>
            {cardHeader(card.icon, card.title)}
            <Box sx={{ display: 'grid', gridTemplateColumns: '18px auto minmax(0, 1fr)', px: 1.5 }}>
              {card.items.map((item, i) => {
                const cellSx = {
                  py: 0.625,
                  display: 'flex',
                  alignItems: 'center',
                  borderBottom: i < card.items.length - 1 ? `1px solid ${alpha(theme.palette.divider, 0.6)}` : 'none',
                }

                return (
                  <Fragment key={item.key}>
                    <Box sx={cellSx}>{item.icon}</Box>
                    <Typography variant="caption" sx={{ ...cellSx, color: 'text.secondary', whiteSpace: 'nowrap', pl: 0.75, pr: 2 }}>
                      {item.label}
                      {item.code && ' '}
                      {item.code && <Box component="span" sx={{ ml: 0.5, fontFamily: MONO, fontSize: 10, opacity: 0.55 }}>{item.code}</Box>}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{ ...cellSx, justifyContent: 'flex-end', textAlign: 'right', color: 'text.primary', fontFamily: item.mono ? MONO : undefined, wordBreak: 'break-all' }}
                    >
                      {item.value}
                    </Typography>
                  </Fragment>
                )
              })}
            </Box>
          </Box>
        ))}
      </Box>

      <Box sx={cardSx}>
        {cardHeader('ri-code-s-slash-line', t('firewallLog.rawLine'), (
          <Tooltip title={copied ? t('common.copied') : t('common.copy')} onClose={() => setCopied(false)}>
            <IconButton size="small" aria-label={t('common.copy')} onClick={copyRaw} sx={{ p: 0.25 }}>
              <i className={copied ? 'ri-check-line' : 'ri-file-copy-line'} style={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        ))}
        <Box sx={{ fontFamily: MONO, fontSize: 11, px: 1.5, py: 1, wordBreak: 'break-all', color: 'text.secondary' }}>{r.raw}</Box>
      </Box>
    </Box>
  )
}
