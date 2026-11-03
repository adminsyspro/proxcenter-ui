'use client'

import { useState, type ReactNode } from 'react'
import { Box, ButtonBase, Collapse, Divider, Typography } from '@mui/material'

/** The sections of the map panels the user folded, remembered per browser (their ids). */
export const PANEL_SECTIONS_KEY = 'proxcenter.microseg.panelSections'

function readFolded(): Set<string> {
  try {
    const raw = window.localStorage.getItem(PANEL_SECTIONS_KEY)
    const list: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    // Storage blocked or a value that is not ours: every section open.
    return new Set()
  }
}

function storeFolded(id: string, folded: boolean) {
  try {
    const set = readFolded()
    if (folded) set.add(id)
    else set.delete(id)
    window.localStorage.setItem(PANEL_SECTIONS_KEY, JSON.stringify([...set]))
  } catch {
    // Nothing to remember it in: the section still folds for this visit.
  }
}

/** The open state of a section, remembered per browser: for a panel that needs to know it (a read to hold). */
export function usePanelSection(id: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => !readFolded().has(id))
  const toggle = () => {
    const next = !open
    storeFolded(id, !next)
    setOpen(next)
  }
  return [open, toggle]
}

type Props = {
  /** Stable id of the section ("zone.members"): its folded state is remembered under it. */
  id: string
  title: string
  /** Shown as a count after the title; nothing when null or undefined. */
  count?: number | null
  /** Something on the right of the header (a button): its clicks do not fold the section. */
  action?: ReactNode
  /** Held by the panel (`usePanelSection`), when it must know whether the section is open. */
  state?: [boolean, () => void]
  children: ReactNode
}

function SectionBody({ id, title, count, action, open, toggle, children }: Omit<Props, 'state'> & { open: boolean; toggle: () => void }) {
  return (
    <Box component='section' aria-label={title} data-section={id} sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, minHeight: 32 }}>
        <ButtonBase
          onClick={toggle}
          aria-expanded={open}
          data-testid={`section-${id}`}
          sx={{ flex: '1 1 0', minWidth: 0, justifyContent: 'flex-start', gap: 0.75, py: 0.5, borderRadius: 1 }}
        >
          <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 16, opacity: 0.7 }} aria-hidden />
          <Typography variant='caption' component='span' noWrap sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.4, minWidth: 0 }}>
            {title}
          </Typography>
          {count !== null && count !== undefined && (
            <Box component='span' data-testid={`section-${id}-count`} sx={{ px: 0.75, minWidth: 18, height: 18, lineHeight: '18px', borderRadius: 9, fontSize: 11, textAlign: 'center', bgcolor: 'action.selected', flexShrink: 0 }}>
              {count}
            </Box>
          )}
        </ButtonBase>
        {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
      </Box>
      <Divider />
      <Collapse in={open} unmountOnExit>
        <Box sx={{ pt: 1, pb: 1.5, minWidth: 0 }}>{children}</Box>
      </Collapse>
    </Box>
  )
}

function OwnSection(props: Omit<Props, 'state'>) {
  const [open, toggle] = usePanelSection(props.id)
  return <SectionBody {...props} open={open} toggle={toggle} />
}

/**
 * A foldable section of a map panel, the look of the inventory's group headers: a chevron, a caption-size title, a
 * count, a divider under it. Open by default; the folded ones are remembered per browser.
 */
export default function PanelSection({ state, ...props }: Props) {
  if (state) return <SectionBody {...props} open={state[0]} toggle={state[1]} />
  return <OwnSection {...props} />
}

/**
 * The frame of a map panel: as tall as the map block on a wide screen (its header stays, its body scrolls inside),
 * below the map with a bounded height on a narrow one.
 */
export function PanelFrame({ label, width, header, children, dataTarget }: { label: string; width: number; header: ReactNode; children: ReactNode; dataTarget?: string }) {
  return (
    <Box sx={{ width: { xs: '100%', lg: width }, flexShrink: 0, minWidth: 0, position: { lg: 'relative' } }}>
      <Box
        component='aside'
        aria-label={label}
        data-target={dataTarget}
        sx={{
          position: { lg: 'absolute' },
          inset: { lg: 0 },
          maxHeight: { xs: 560, lg: 'none' },
          display: 'flex',
          flexDirection: 'column',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <Box sx={{ p: 2, pb: 1, flexShrink: 0, minWidth: 0 }}>{header}</Box>
        <Box data-testid='panel-body' sx={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', px: 2, pb: 2 }}>{children}</Box>
      </Box>
    </Box>
  )
}
