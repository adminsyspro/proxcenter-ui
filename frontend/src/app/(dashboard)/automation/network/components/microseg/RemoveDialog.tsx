'use client'

import { useState } from 'react'
import { MenuItem, Select } from '@mui/material'
import { useTranslations } from 'next-intl'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'

import type { NamedConnection } from './clusterModel'
import { ConnectionLine, useConnectionKinds } from './ConnectionGlyph'
import { FormRow, OneLine } from './dialogParts'
import TypedConfirmDialog from './TypedConfirmDialog'

type Props = {
  /** The connection the admin must type. */
  connectionName: string
  /**
   * Given only when the policy is shared: the clusters the user sees, by name, the tab's first selected. The rules are
   * removed from the one chosen, which leaves the shared policy; its name is the one to type.
   */
  clusters?: { options: NamedConnection[]; initial: string }
  busy: boolean
  error: string | null
  /** Starts the removal on the cluster chosen (the tab's connection for a policy of one cluster); only called once its name has been typed. */
  onConfirm: (clusterId?: string) => void
  onCancel: () => void
}

/**
 * Confirmation of the removal of the micro-segmentation: the name of the connection has to be typed, exactly. On a
 * shared policy the cluster is chosen first, on its own line: the removal undoes what ProxCenter wrote on that cluster
 * only, and that cluster leaves the shared policy with nothing of it kept there.
 */
export default function RemoveDialog({ connectionName, clusters, busy, error, onConfirm, onCancel }: Props) {
  const t = useTranslations('microsegPilot.settings')
  const [picked, setPicked] = useState(clusters?.initial ?? '')
  const kinds = useConnectionKinds(clusters?.options.map(o => o.id) ?? [])
  if (!clusters) {
    return (
      <TypedConfirmDialog
        title={t('remove.title')}
        lines={[t('remove.body'), t('remove.tagsKept')]}
        inputLabel={t('remove.typeName', { name: connectionName })}
        expected={connectionName}
        confirmLabel={t('remove.confirm')}
        busy={busy}
        error={error}
        onConfirm={() => onConfirm()}
        onCancel={onCancel}
      />
    )
  }
  const name = clusters.options.find(o => o.id === picked)?.name ?? ''
  return (
    <TypedConfirmDialog
      title={t('remove.title')}
      lines={[t('remove.bodyShared')]}
      inputLabel={t('remove.typeName', { name })}
      expected={name}
      confirmLabel={t('remove.confirm')}
      ready={!!name}
      busy={busy}
      error={error}
      onConfirm={() => onConfirm(picked)}
      onCancel={onCancel}
    >
      <FormRow label={t('clusters.target')}>
        <Select
          size='small'
          fullWidth
          value={picked}
          disabled={busy}
          onChange={e => setPicked(e.target.value)}
          inputProps={{ 'aria-label': t('clusters.target') }}
          sx={SMALL_SELECT_SX}
        >
          {clusters.options.map(o => <MenuItem key={o.id} value={o.id}><ConnectionLine name={o.name} kind={kinds[o.id]} /></MenuItem>)}
        </Select>
      </FormRow>
      {name ? <OneLine text={t('remove.leaves', { name })} /> : null}
    </TypedConfirmDialog>
  )
}
