'use client'

import { useCallback, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Box, ButtonBase, Collapse, Divider, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

/** The sections of the map panels the user folded, remembered per browser (their ids). */
export const PANEL_SECTIONS_KEY = 'proxcenter.microseg.panelSections'

/** The sections that start folded until the user opens them once (their id, then stored as opened). */
const OPENED_KEY_SUFFIX = ':opened'

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
export function usePanelSection(id: string, defaultOpen = true): [boolean, () => void] {
  // A section folded by default is remembered by its opened mark instead.
  const mark = defaultOpen ? id : `${id}${OPENED_KEY_SUFFIX}`
  const [open, setOpen] = useState(() => readFolded().has(mark) !== defaultOpen)
  const toggle = () => {
    const next = !open
    storeFolded(mark, defaultOpen ? !next : next)
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
  /** False: folded until the user opens it (context the panel does not lead with). */
  defaultOpen?: boolean
  /** A Remix icon class before the title ("ri-computer-line"). */
  icon?: string
  children: ReactNode
}

/** One line of a section's list: the same height and the same rule under it in every section, so they line up. */
export const LIST_ROW_SX = { minHeight: 36, borderBottom: 1, borderColor: 'divider' } as const

function SectionBody({ id, title, count, action, icon, open, toggle, children }: Omit<Props, 'state' | 'defaultOpen'> & { open: boolean; toggle: () => void }) {
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
          {icon && <i className={icon} data-testid={`section-${id}-icon`} style={{ fontSize: 15, opacity: 0.8, flexShrink: 0 }} aria-hidden />}
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

function OwnSection({ defaultOpen, ...props }: Omit<Props, 'state'>) {
  const [open, toggle] = usePanelSection(props.id, defaultOpen)
  return <SectionBody {...props} open={open} toggle={toggle} />
}

/**
 * A foldable section of a map panel, the look of the inventory's group headers: a chevron, a caption-size title, a
 * count, a divider under it. Open by default; the folded ones are remembered per browser.
 */
export default function PanelSection({ state, ...props }: Props) {
  if (state) {
    const { defaultOpen: _ignored, ...rest } = props
    return <SectionBody {...rest} open={state[0]} toggle={state[1]} />
  }
  return <OwnSection {...props} />
}

/** The widest a map panel may be dragged to (px), and the step of the arrow keys on its edge. */
export const PANEL_MAX_WIDTH = 1100
const PANEL_KEY_STEP = 32
const PANEL_WIDTH_KEY = 'microseg.map.panelWidth'

/** The width kept in this browser for the map panels, or none (each panel then takes its own). */
function readPanelWidth(): number | null {
  try {
    const n = Number(window.localStorage.getItem(PANEL_WIDTH_KEY))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function keepPanelWidth(width: number | null) {
  try {
    if (width === null) window.localStorage.removeItem(PANEL_WIDTH_KEY)
    else window.localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(width)))
  } catch {
    // Storage refused: the width lasts as long as the page.
  }
}

/** A width between the panel's own (its narrowest) and PANEL_MAX_WIDTH. */
export const clampPanelWidth = (width: number, min: number) => Math.min(PANEL_MAX_WIDTH, Math.max(min, Math.round(width)))

/**
 * The width of a map panel on a wide screen: its own until the user drags its left edge (or moves it with the arrow
 * keys), then the one chosen, the same for every map panel and kept in this browser; a double click on the edge gives
 * the panel its own width back.
 */
function usePanelWidth(own: number) {
  const [chosen, setChosen] = useState<number | null>(readPanelWidth)
  const width = chosen === null ? own : clampPanelWidth(chosen, own)
  const choose = useCallback((next: number | null) => {
    setChosen(next)
    keepPanelWidth(next)
  }, [])
  const startDrag = useCallback((e: PointerEvent<HTMLElement>) => {
    e.preventDefault()
    const from = e.clientX
    let last = width
    const move = (ev: globalThis.PointerEvent) => {
      // The edge is on the left: dragging it to the left widens the panel.
      last = clampPanelWidth(width + from - ev.clientX, own)
      setChosen(last)
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      keepPanelWidth(last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }, [width, own])
  const onKey = useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    choose(clampPanelWidth(width + (e.key === 'ArrowLeft' ? PANEL_KEY_STEP : -PANEL_KEY_STEP), own))
  }, [width, own, choose])
  return { width, startDrag, onKey, reset: () => choose(null) }
}

/**
 * The frame of a map panel: as tall as the map block on a wide screen (its header stays, its body scrolls inside),
 * below the map with a bounded height on a narrow one. On a wide screen its left edge widens it (drag, arrow keys).
 */
export function PanelFrame({ label, width: own, header, children, dataTarget }: { label: string; width: number; header: ReactNode; children: ReactNode; dataTarget?: string }) {
  const t = useTranslations('microsegPilot.overview.panel')
  const { width, startDrag, onKey, reset } = usePanelWidth(own)
  return (
    <Box sx={{ width: { xs: '100%', lg: width }, flexShrink: 0, minWidth: 0, position: { lg: 'relative' } }}>
      <Box
        role='separator'
        aria-orientation='vertical'
        aria-label={t('resize')}
        aria-valuenow={width}
        aria-valuemin={own}
        aria-valuemax={PANEL_MAX_WIDTH}
        tabIndex={0}
        title={t('resize')}
        data-testid='panel-resize'
        onPointerDown={startDrag}
        onKeyDown={onKey}
        onDoubleClick={reset}
        sx={{
          display: { xs: 'none', lg: 'block' }, position: 'absolute', top: 0, bottom: 0, left: -6, width: 8, zIndex: 2, cursor: 'col-resize',
          touchAction: 'none', borderRadius: 1, '&:hover, &:focus-visible': { bgcolor: 'primary.main', opacity: 0.4, outline: 'none' },
        }}
      />
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
