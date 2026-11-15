'use client'

import { createContext, useContext, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Box, Tooltip } from '@mui/material'
import { useTranslations } from 'next-intl'

import { useRBAC } from '@/contexts/RBACContext'

/** Every micro-segmentation write of the relay asks node.manage on the connection. */
export const MICROSEG_WRITE_PERMISSION = 'node.manage'

/**
 * Whether the session may write the micro-segmentation of a connection. While the rights are still loading nothing is
 * disabled: the relay checks them on every write anyway, this only spares a read-only user controls that would fail.
 */
export function useCanManageMicroseg(connectionId: string): boolean {
  const { hasPermissionOn, loading } = useRBAC()
  return loading || (!!connectionId && hasPermissionOn(MICROSEG_WRITE_PERMISSION, 'connection', connectionId))
}

/** Set by the tab for everything under it; outside the tab (a component on its own) the writes are allowed. */
export const MicrosegWriteContext = createContext(true)

/** The write access of the tab and the hint a disabled write control shows. */
export function useMicrosegWrite(): { canWrite: boolean; hint: string } {
  const canWrite = useContext(MicrosegWriteContext)
  const t = useTranslations('microsegPilot')
  return { canWrite, hint: t('readOnly') }
}

/**
 * The tooltip of a write control: its own `title` when the user can write, the read-only hint when not. The child sits
 * in a span, so the tooltip still shows on a disabled button. The caller disables the control with `!canWrite`.
 */
export function WriteTip({ title, children }: { title?: ReactNode; children: ReactElement }) {
  const { canWrite, hint } = useMicrosegWrite()
  const shown = canWrite ? title : hint
  if (!shown) return children
  return (
    <Tooltip title={shown}>
      <span style={{ display: 'inline-flex', flexShrink: 0 }}>{children}</span>
    </Tooltip>
  )
}

/**
 * The element of the tab row (next to the sub-tabs) the sub-tab actions are rendered into. Null outside the tab, or
 * before the row is mounted: the actions then stay in place.
 */
export const MicrosegActionsSlot = createContext<HTMLElement | null>(null)

/**
 * Renders the actions of a sub-tab in the row of the tab when it provides a slot, in place otherwise. `order` keeps the
 * actions of the several sections in a fixed sequence in the row, whatever the order they mount in.
 */
export function SlotActions({ order, children }: { order: number; children: ReactNode }) {
  const slot = useContext(MicrosegActionsSlot)
  if (!slot) return <>{children}</>
  return createPortal(<Box sx={{ order, display: 'inline-flex' }}>{children}</Box>, slot)
}
