'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import * as firewallAPI from '@/lib/api/firewall'
import type { GroupUsage, UsageMember } from '@/hooks/useGroupUsage'

import MicrosegConfirmDialog, { type ConfirmInfoLine } from '../../microseg/MicrosegConfirmDialog'
import { detachGroup, nodesNamingGroup } from './groupDetach'
import GuestOnNodeLine from './GuestOnNodeLine'

/** Guests named one per line in the dialog; the others are counted on a last line. */
export const DELETE_GROUP_LISTED = 5

interface DeleteSecurityGroupDialogProps {
  groupName: string
  connectionId: string
  /** The group's own rules: Proxmox refuses to delete a group that still has some, so they are deleted first. */
  rules: firewallAPI.FirewallRule[]
  /** The cluster rules and the nodes whose rules name the group: it is not deleted while they do. */
  scope: { cluster: boolean; nodes: string[] }
  /** Every node of the connection: their own rules are read when the dialog opens, like those of the guests. */
  nodes: string[]
  /** Reads the rules of every guest again (hooks/useGroupUsage `check`). */
  check: () => Promise<GroupUsage>
  /** The state of the guests (by `type/vmid`) and of the nodes, for their dots; already known by the page. */
  guestStatus?: Record<string, string>
  nodeStatus?: Record<string, string>
  onClose: () => void
  /** The group is gone; `detached` are the guests it was removed from. */
  onDeleted: (detached: UsageMember[]) => void
}

type Checked = { members: UsageMember[]; unread: number; nodesNaming: string[]; nodesUnread: string[] }

const memberLabel = (m: UsageMember) => `${m.name} (${m.vmid}) · ${m.node}`

/** What the check found, one line each: the guests carrying the group, then what could not be read. */
function checkedLines(
  checked: Checked,
  t: ReturnType<typeof useTranslations>,
  guestStatus?: Record<string, string>,
  nodeStatus?: Record<string, string>,
): ConfirmInfoLine[] {
  const lines: ConfirmInfoLine[] = []

  if (checked.members.length === 0) lines.push({ icon: 'ri-checkbox-circle-line', text: t('networkPage.groupUsage.noMember') })
  for (const m of checked.members.slice(0, DELETE_GROUP_LISTED)) {
    lines.push({
      icon: '',
      text: memberLabel(m),
      content: <GuestOnNodeLine guest={m} guestStatus={guestStatus?.[`${m.type}/${m.vmid}`]} nodeStatus={nodeStatus?.[m.node]} />,
    })
  }
  if (checked.members.length > DELETE_GROUP_LISTED) {
    lines.push({ icon: 'ri-more-line', text: t('networkPage.groupUsage.moreMembers', { count: checked.members.length - DELETE_GROUP_LISTED }) })
  }
  if (checked.unread > 0) lines.push({ icon: 'ri-error-warning-line', text: t('networkPage.groupUsage.unchecked', { count: checked.unread }) })
  if (checked.nodesUnread.length > 0) lines.push({ icon: 'ri-error-warning-line', text: t('networkPage.groupUsage.nodesUnchecked', { nodes: checked.nodesUnread.join(', ') }) })

  return lines
}

/**
 * Deleting a security group. Proxmox deletes an empty group even while guests still name it, and their rule then
 * points at nothing. So the guests are read first: those carrying the group are listed, and confirming detaches the
 * group from each of them, deletes its rules, then the group. A group a cluster or node rule names is kept.
 */
export default function DeleteSecurityGroupDialog({ groupName, connectionId, rules, scope, nodes, check, guestStatus, nodeStatus, onClose, onDeleted }: Readonly<DeleteSecurityGroupDialogProps>) {
  const t = useTranslations()
  const [checked, setChecked] = useState<Checked | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The check runs when the dialog opens and again on Retry. Only the check asked last may answer (the effect runs
  // twice in development, Retry may be pressed twice): an earlier one is told it is no longer listened to.
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let listened = true
    Promise.all([check(), nodesNamingGroup(connectionId, nodes, groupName)]).then(
      ([usage, ofNodes]) => {
        if (listened) setChecked({ members: usage.groups[groupName] ?? [], unread: usage.unread, nodesNaming: ofNodes.naming, nodesUnread: ofNodes.unread })
      },
      (err: unknown) => { if (listened) setCheckError(err instanceof Error && err.message ? err.message : t('networkPage.error')) },
    )

    return () => { listened = false }
  }, [check, connectionId, nodes, groupName, attempt, t])
  const retry = () => {
    setChecked(null)
    setCheckError(null)
    setAttempt(n => n + 1)
  }

  const scopeNodes = [...new Set([...scope.nodes, ...(checked?.nodesNaming ?? [])])].sort((a, b) => a.localeCompare(b))
  const scoped = scope.cluster || scopeNodes.length > 0

  const lines: ConfirmInfoLine[] = []
  if (scope.cluster) lines.push({ icon: 'ri-server-line', text: t('networkPage.groupUsage.scopeCluster') })
  if (scopeNodes.length > 0) lines.push({ icon: 'ri-server-line', text: t('networkPage.groupUsage.scopeNodes', { nodes: scopeNodes.join(', ') }) })
  if (!checked && !checkError) lines.push({ icon: 'ri-loader-4-line', text: t('networkPage.groupUsage.checking') })
  if (checked) lines.push(...checkedLines(checked, t, guestStatus, nodeStatus))

  const confirm = async () => {
    if (!checked) return
    setBusy(true)
    setError(null)
    const detached: UsageMember[] = []

    try {
      // One guest at a time: Proxmox rewrites the guest's rule file on each deletion.
      for (const member of checked.members) {
        try {
          await detachGroup(connectionId, member, groupName)
          detached.push(member)
        } catch {
          throw new Error(t('networkPage.groupUsage.detachFailed', { guest: memberLabel(member) }))
        }
      }
      // From the last position to the first, so no deletion shifts the next one.
      const positions = rules.map((r, i) => r.pos ?? i).sort((a, b) => b - a)
      for (const pos of positions) await firewallAPI.deleteSecurityGroupRule(connectionId, groupName, pos)
      await firewallAPI.deleteSecurityGroup(connectionId, groupName)
      onDeleted(detached)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('networkPage.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <MicrosegConfirmDialog
      open
      title={t('networkPage.deleteSgConfirm', { name: groupName })}
      body={t('networkPage.groupUsage.deleteBody')}
      infoLines={lines}
      confirmLabel={checked && checked.members.length > 0
        ? t('networkPage.groupUsage.detachAndDelete', { count: checked.members.length })
        : t('common.delete')}
      color='error'
      busy={busy}
      confirmDisabled={!checked || scoped}
      error={checkError ? t('networkPage.groupUsage.checkFailed') : error}
      errorDetail={checkError}
      extraAction={checkError ? { label: t('common.retry'), onClick: retry } : undefined}
      onConfirm={() => { void confirm() }}
      onCancel={onClose}
    />
  )
}
