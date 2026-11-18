'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'

import { microsegApi } from '@/lib/microseg/api'
import type { MicrosegZone } from '@/lib/microseg/types'

import { dissociationImpact, type GroupGuest, type NamedConnection } from './clusterModel'
import { useDialogAction } from './dialogParts'
import TypedConfirmDialog from './TypedConfirmDialog'

type Props = {
  /** The connection the policy is read through (the URL of the call). */
  connectionId: string
  /** The cluster leaving the group; its name has to be typed. */
  target: NamedConnection
  /** The guests of every cluster of the group; undefined while they are not known (no count is shown then). */
  guests?: readonly GroupGuest[]
  zones: readonly Pick<MicrosegZone, 'name' | 'state'>[]
  tagPrefix: string
  /** Called once the backend has unlinked the cluster. */
  onDone: () => void
  onCancel: () => void
}

/**
 * Confirmation of a dissociation, by typing the cluster's name: how many guests each side stops recognising at the
 * next pass, and that the cluster keeps its rules with its own copy of the policy.
 */
export default function DissociateClusterDialog({ connectionId, target, guests, zones, tagPrefix, onDone, onCancel }: Readonly<Props>) {
  const t = useTranslations('microsegPilot.settings.clusters.dissociate')
  const api = useMemo(() => microsegApi(connectionId), [connectionId])
  const action = useDialogAction()

  const impact = guests ? dissociationImpact(guests, zones, target.id, tagPrefix) : null
  const lines = [
    ...(impact ? [t('impact', { name: target.name, leaving: impact.leaving, staying: impact.staying })] : []),
    t('keepsRules', { name: target.name }),
  ]

  const confirm = async () => {
    const ok = await action.run(() => api.dissociateCluster(target.id))
    if (ok) onDone()
  }

  return (
    <TypedConfirmDialog
      title={t('title', { name: target.name })}
      lines={lines}
      inputLabel={t('typeName', { name: target.name })}
      expected={target.name}
      confirmLabel={t('confirm')}
      busy={action.busy}
      error={action.error}
      onConfirm={() => void confirm()}
      onCancel={onCancel}
    />
  )
}
