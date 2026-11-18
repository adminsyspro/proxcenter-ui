'use client'

import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react'
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

/**
 * Whether the session may write on every one of these connections: a write on the whole of a shared policy (its removal
 * from one cluster rewrites the others) needs node.manage on each, as the relay checks. Same loading rule as above.
 */
export function useCanManageEvery(connectionIds: readonly string[]): boolean {
  const { hasPermissionOn, loading } = useRBAC()
  return loading || (connectionIds.length > 0 && connectionIds.every(id => !!id && hasPermissionOn(MICROSEG_WRITE_PERMISSION, 'connection', id)))
}

/** Set by the tab for everything under it; outside the tab (a component on its own) the writes are allowed. */
export const MicrosegWriteContext = createContext(true)

/** The writes of one cluster's own data: its members, its exceptions, its check, its held writes (relay `cluster` scope). */
export type MicrosegClusterWrite = {
  /** node.manage on that cluster (an empty ID is the tab's connection). */
  canWriteOn: (connectionId: string) => boolean
  /** canWriteOn holds for at least one cluster of the policy: a control whose cluster is picked afterwards. */
  canWriteSome: boolean
}

/** What the session may write through the micro-segmentation of a connection and the policy it shares. */
export type MicrosegAccess = MicrosegClusterWrite & {
  /** A write on the whole policy (relay `policy` scope): node.manage on every linked cluster. */
  canWrite: boolean
  /** The policy is shared and that right is missing on one of its clusters (or still loading): the hint says so. */
  everyCluster: boolean
}

/**
 * The access of the micro-segmentation of `connectionId`, whose policy links `clusterIds` (those of the draft already
 * read; none or one: a policy of its own). One cluster keeps the rule of useCanManageMicroseg (nothing disabled while
 * the rights load). A shared policy follows the relay: a policy write needs node.manage on every linked cluster, a
 * cluster write on that cluster; a cluster outside the user's scope has no right, and nothing is writable while the
 * rights load (fail closed). Reads only the rights the page already holds: no request.
 */
export function useMicrosegAccess(connectionId: string, clusterIds: readonly string[]): MicrosegAccess {
  const { hasPermissionOn, loading } = useRBAC()
  const key = [...new Set(clusterIds)].join('\n')
  return useMemo(() => {
    const ids = key ? key.split('\n') : []
    const manage = (id: string) => !!id && hasPermissionOn(MICROSEG_WRITE_PERMISSION, 'connection', id)
    if (ids.length < 2) {
      const can = loading || manage(connectionId)
      return { canWrite: can, everyCluster: false, canWriteOn: () => can, canWriteSome: can }
    }
    const canWriteOn = (id: string) => !loading && manage(id || connectionId)
    const canWrite = ids.every(canWriteOn)
    return { canWrite, everyCluster: !canWrite, canWriteOn, canWriteSome: ids.some(canWriteOn) }
  }, [hasPermissionOn, loading, connectionId, key])
}

const MicrosegAccessContext = createContext<MicrosegAccess | null>(null)

/** Gives the access of a policy to everything under it: the policy writes through MicrosegWriteContext, the cluster writes beside. */
export function MicrosegAccessProvider({ value, children }: { value: MicrosegAccess; children: ReactNode }) {
  return (
    <MicrosegWriteContext.Provider value={value.canWrite}>
      <MicrosegAccessContext.Provider value={value}>{children}</MicrosegAccessContext.Provider>
    </MicrosegWriteContext.Provider>
  )
}

/** The hint of a disabled policy write: the right missing on a cluster of a shared policy (named none), or read-only. */
export function useAccessHint(access: Pick<MicrosegAccess, 'everyCluster'> | null): string {
  const t = useTranslations('microsegPilot')
  return access?.everyCluster ? t('settings.remove.needsEveryCluster') : t('readOnly')
}

/** The write access of the tab (a write on the whole policy) and the hint a disabled write control shows. */
export function useMicrosegWrite(): { canWrite: boolean; hint: string } {
  const canWrite = useContext(MicrosegWriteContext)
  const hint = useAccessHint(useContext(MicrosegAccessContext))
  return { canWrite, hint }
}

/**
 * The writes of one cluster's own data. Outside a MicrosegAccessProvider (a component on its own, a page that gives a
 * plain MicrosegWriteContext) they follow that value, as every write did.
 */
export function useMicrosegClusterWrite(): MicrosegClusterWrite {
  const canWrite = useContext(MicrosegWriteContext)
  const access = useContext(MicrosegAccessContext)
  return useMemo(() => access ?? { canWriteOn: () => canWrite, canWriteSome: canWrite }, [access, canWrite])
}

/**
 * The tooltip of a write control: its own `title` when the user can write, the reason when not. The child sits in a
 * span, so the tooltip still shows on a disabled button. The caller disables the control with the same right: the
 * policy write of the context by default, or `allowed` (a cluster write, whose reason is read-only), with `hint` to
 * word that reason otherwise.
 */
export function WriteTip({ title, allowed, hint: givenHint, children }: { title?: ReactNode; allowed?: boolean; hint?: string; children: ReactElement }) {
  const write = useMicrosegWrite()
  const readOnly = useTranslations('microsegPilot')('readOnly')
  const canWrite = allowed ?? write.canWrite
  const hint = givenHint ?? (allowed === undefined ? write.hint : readOnly)
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
export function SlotActions({ order, grow = false, children }: { order: number; grow?: boolean; children: ReactNode }) {
  const slot = useContext(MicrosegActionsSlot)
  if (!slot) return <>{children}</>
  // A growing group (the filters of a list) takes the room left on the row; the others keep their own width.
  return createPortal(<Box sx={{ order, display: grow ? 'flex' : 'inline-flex', ...(grow ? { flex: '1 1 auto', minWidth: 0 } : {}) }}>{children}</Box>, slot)
}
