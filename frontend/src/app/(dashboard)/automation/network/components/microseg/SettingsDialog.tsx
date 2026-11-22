'use client'

import { useMemo, useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material'
import { useTranslations } from 'next-intl'
import { useSWRConfig } from 'swr'

import { microsegApi } from '@/lib/microseg/api'
import { clustersKey, isClustersKey } from '@/lib/microseg/useMicrosegGroup'
import type { MicrosegCluster, MicrosegPolicy } from '@/lib/microseg/types'

import AssociateClusterDialog from './AssociateClusterDialog'
import AssociatedClustersLine from './AssociatedClustersLine'
import { candidates, type GroupGuest, type NamedConnection } from './clusterModel'
import { shownClusterName } from './ClusterRunRow'
import { DialogErrorLine, FormRow, ONE_LINE_SX, isVersionConflict, useDialogAction } from './dialogParts'
import DissociateClusterDialog from './DissociateClusterDialog'
import { useGroupGuests } from './useGroupGuests'
import RemoveDialog from './RemoveDialog'
import TypedConfirmDialog from './TypedConfirmDialog'
import SettingsFields, { SETTINGS_LABEL_WIDTH, SectionTitle } from './SettingsFields'
import {
  SETTING_UNITS, changedUpdate, formFromSettings, validateSettingsForm, type SettingNumberKey, type SettingsForm,
} from './settingsModel'
import type { TrackedRun } from './microsegTabTypes'
import { WriteTip, useCanManageEvery, useMicrosegWrite } from './microsegAccess'

type Props = {
  connectionId: string
  /** Typed to confirm the removal. */
  connectionName: string
  policy: MicrosegPolicy
  reloadPolicy: () => Promise<unknown>
  startRun: (run: TrackedRun) => void
  onClose: () => void
  /** The PVE connections the user sees: those that can be associated. */
  connections?: NamedConnection[]
  /** The connections already sharing another policy (the page's groups): never proposed. */
  groupedElsewhere?: string[]
  /** The name of a cluster, the tab's lookup; without it the connection's own name, else the ID. */
  clusterName?: (id: string) => string
  /** The most clusters a policy takes (GET clusters); unknown until it answers. */
  maxClusters?: number
  /**
   * The guests of every cluster of the group, for the count of a dissociation. Absent: they are read while the
   * dissociation dialog is open (and no count is shown while one cluster's read is missing).
   */
  groupGuests?: GroupGuest[]
  /** Re-reads the group of the connection after an association or a dissociation. */
  onClustersChanged?: () => void
  /** A cluster left the group: who left and who remains, so the page can leave its selection on the group. */
  onDissociated?: (left: string, remaining: string[]) => void
}

type DissociateProps = Omit<Parameters<typeof DissociateClusterDialog>[0], 'guests'> & {
  clusterIds: string[]
  /** The guests the caller already holds: nothing is read then. */
  known?: GroupGuest[]
}

/**
 * The dissociation dialog with the guests of every cluster of the group, read only while it is open. The counts need
 * every cluster: while one is loading or failed, none is shown rather than a partial one.
 */
function DissociateWithGroupGuests({ clusterIds, known, ...props }: Readonly<DissociateProps>) {
  const { guests, loading, errors } = useGroupGuests(known ? [] : clusterIds)
  const complete = !loading && Object.keys(errors).length === 0
  return <DissociateClusterDialog {...props} guests={known ?? (complete ? guests : undefined)} />
}

/** The clusters of the policy, as GET /policy lists them; an orchestrator that does not send them has the connection alone. */
function clustersOf(policy: MicrosegPolicy, connectionId: string): Pick<MicrosegCluster, 'connection_id' | 'active'>[] {
  return Array.isArray(policy.clusters) && policy.clusters.length > 0 ? policy.clusters : [{ connection_id: connectionId, active: true }]
}

/**
 * The settings of the micro-segmentation of a connection (tag prefix, load on
 * Proxmox, observation, notifications) and its removal. Saves only the fields
 * that changed since the dialog opened; a 409 reloads the draft and keeps the
 * input, so the same save can be sent again against the new version.
 */
export default function SettingsDialog({
  connectionId, connectionName, policy, reloadPolicy, startRun, onClose, connections = [], groupedElsewhere, clusterName: nameOf, maxClusters,
  groupGuests, onClustersChanged, onDissociated,
}: Props) {
  const t = useTranslations('microsegPilot.settings')
  const tc = useTranslations('common')
  const tAll = useTranslations()
  const api = useMemo(() => microsegApi(connectionId), [connectionId])
  const save = useDialogAction()
  const removal = useDialogAction()
  const { canWrite } = useMicrosegWrite()

  // The form at opening: what "changed" is measured against, even if the draft moves meanwhile.
  const [baseline] = useState(() => formFromSettings(policy.policy.tag_prefix, policy.policy.settings, policy.policy.ip_filter))
  const [form, setForm] = useState<SettingsForm>(baseline)
  const [removing, setRemoving] = useState(false)
  const [confirmingPrefix, setConfirmingPrefix] = useState(false)
  const [associating, setAssociating] = useState(false)
  const [dissociating, setDissociating] = useState<string | null>(null)
  const { mutate } = useSWRConfig()

  const clusters = clustersOf(policy, connectionId)
  // The removal is a write on the whole policy (a cluster leaving it rewrites the others): node.manage on every cluster.
  const canRemove = useCanManageEvery(clusters.map(c => c.connection_id))
  const clusterName = nameOf ?? ((id: string) => (id === connectionId ? connectionName : id))
  // The name a line shows: general words for a cluster outside the user's scope, never its ID.
  const shownName = (id: string) => shownClusterName(id, connectionId, clusterName, tAll('microsegPilot.plan.cluster.other'))
  const joinable = candidates(connections, clusters.map(c => c.connection_id), groupedElsewhere)
  // A shared policy: the removal is chosen per cluster, among those the user sees (the tab's first selected).
  const removeChoice = clusters.length < 2 ? undefined : {
    options: clusters.flatMap(c => {
      const name = shownClusterName(c.connection_id, connectionId, clusterName)
      return name === null ? [] : [{ id: c.connection_id, name }]
    }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id)),
    initial: connectionId,
  }

  const problems = validateSettingsForm(form, baseline)
  const firstProblem = Object.entries(problems)[0]
  const update = changedUpdate(baseline, form)

  const problemText = () => {
    if (!firstProblem) return null
    const [field, problem] = firstProblem
    const values: Record<string, string | number> = { ...problem.values }
    if (problem.key === 'range') {
      values.label = t(`fields.${field}`)
      values.unit = t(`unitsLong.${SETTING_UNITS[field as SettingNumberKey]}`)
    }
    return t(`validation.${problem.key}`, values)
  }

  // Zones find their members by tag: other tags would take every guest out of its zone at the next apply.
  const prefixChanged = update?.tag_prefix !== undefined && policy.zones.length > 0

  const submit = async () => {
    if (!update || firstProblem) return
    setConfirmingPrefix(false)
    const ok = await save.run(async () => {
      try {
        await api.savePolicy({ version: policy.version, ...update })
      } catch (e) {
        if (isVersionConflict(e)) await reloadPolicy().catch(() => undefined)
        throw e
      }
    })
    if (!ok) return
    await reloadPolicy().catch(() => undefined)
    onClose()
  }

  /**
   * The removal goes through the cluster it removes the rules from (the tab's connection by default): on a shared
   * policy that cluster leaves the policy, the others only get a light pass. Its run is followed through that cluster.
   */
  const remove = async (cluster = connectionId) => {
    const label = removeChoice ? shownName(cluster) : connectionName
    const ok = await removal.run(async () => {
      const elsewhere = cluster !== connectionId
      const started = await (elsewhere ? microsegApi(cluster) : api).startRemove()
      startRun({
        runId: started.run_id,
        ...(elsewhere ? { runs: [{ connection_id: cluster, run_id: started.run_id }] } : {}),
        kind: 'remove',
        label,
        runningText: t('remove.running', { label }),
      })
    })
    if (ok) onClose()
  }

  // The group changed: this connection's group, the groups the page's selector read for the other connections
  // (they collapse into one entry or split) and the draft (its clusters and pending changes) are read again.
  const clustersChanged = () => {
    const own = clustersKey(connectionId)
    onClustersChanged?.()
    void mutate((key: unknown) => isClustersKey(key) && key !== own)
    void reloadPolicy().catch(() => undefined)
  }

  const busy = save.busy
  const shown = problemText()
  const errorLine = shown || save.error

  return (
    <>
      <Dialog open onClose={busy ? undefined : onClose} maxWidth='sm' fullWidth scroll='paper' aria-labelledby='microseg-settings-title'>
        <DialogTitle id='microseg-settings-title' sx={{ ...ONE_LINE_SX, display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-settings-3-line' data-testid='settings-dialog-icon' style={{ fontSize: 18, flexShrink: 0 }} />
          <Box component='span' sx={ONE_LINE_SX}>{t('title')}</Box>
        </DialogTitle>
        <DialogContent dividers>
          <SettingsFields
            form={form}
            problems={problems}
            busy={busy}
            prefixWarning={prefixChanged}
            effectiveSelfIps={policy.self_ips_effective}
            selfIpsSource={policy.self_ips_source}
            selfIpsDockerInternal={policy.self_ips_docker_internal}
            generalRows={(
              <AssociatedClustersLine
                connectionId={connectionId}
                clusters={clusters}
                max={maxClusters}
                candidateCount={joinable.length}
                clusterName={clusterName}
                busy={busy}
                onAdd={() => setAssociating(true)}
                onRemove={setDissociating}
              />
            )}
            onChange={(key, value) => setForm(prev => ({ ...prev, [key]: value }))}
          />
          <SectionTitle>{t('sections.removal')}</SectionTitle>
          <FormRow label={t('remove.row')} tip={t('remove.hint')} labelWidth={SETTINGS_LABEL_WIDTH}>
            <WriteTip title={canRemove ? undefined : t('remove.needsEveryCluster')}>
              <Button
                size='small'
                color='error'
                variant='outlined'
                disabled={!canWrite || !canRemove || busy}
                onClick={() => { removal.reset(); setRemoving(true) }}
                sx={{ whiteSpace: 'nowrap' }}
              >
                {t('remove.button')}
              </Button>
            </WriteTip>
          </FormRow>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {errorLine ? <DialogErrorLine message={errorLine} /> : null}
          </Box>
          <Button onClick={onClose} disabled={busy}>{tc('cancel')}</Button>
          <WriteTip>
            <Button onClick={() => (prefixChanged ? setConfirmingPrefix(true) : void submit())} variant='contained' disabled={!canWrite || busy || !update || !!firstProblem}>{tc('save')}</Button>
          </WriteTip>
        </DialogActions>
      </Dialog>
      {confirmingPrefix && (
        <TypedConfirmDialog
          title={t('prefixChange.title')}
          lines={[t('prefixChange.body')]}
          inputLabel={t('prefixChange.typeName', { prefix: form.tagPrefix })}
          expected={form.tagPrefix}
          confirmLabel={t('prefixChange.confirm')}
          onConfirm={() => void submit()}
          onCancel={() => setConfirmingPrefix(false)}
        />
      )}
      {associating && (
        <AssociateClusterDialog
          connectionId={connectionId}
          candidates={joinable}
          slots={maxClusters === undefined ? undefined : maxClusters - clusters.length}
          onDone={() => { setAssociating(false); clustersChanged() }}
          onChanged={clustersChanged}
          onCancel={() => setAssociating(false)}
        />
      )}
      {dissociating && (
        <DissociateWithGroupGuests
          clusterIds={clusters.map(c => c.connection_id)}
          known={groupGuests}
          connectionId={connectionId}
          target={{ id: dissociating, name: shownName(dissociating) }}
          zones={policy.zones}
          tagPrefix={policy.policy.tag_prefix}
          onDone={() => {
            const left = dissociating
            setDissociating(null)
            clustersChanged()
            onDissociated?.(left, clusters.map(c => c.connection_id).filter(id => id !== left))
          }}
          onCancel={() => setDissociating(null)}
        />
      )}
      {removing && (
        <RemoveDialog
          connectionName={connectionName}
          clusters={removeChoice}
          busy={removal.busy}
          error={removal.error}
          onConfirm={cluster => void remove(cluster)}
          onCancel={() => setRemoving(false)}
        />
      )}
    </>
  )
}
