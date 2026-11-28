'use client'

import { useId, useState } from 'react'
import { Alert, Box, Button, Checkbox, Collapse, FormControlLabel, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { CephRelease, CephRepository } from '@/lib/ceph/pvecephCommands'
import { FormRow, NumberRow, SelectRow } from '../provisionUi'
import { SshVerdictAlert, type SshVerdict } from '../provisionTask'
import { StateDot } from '../ui'

/*
   The steps of the Ceph deploy wizard (ui#1450). Each one only renders what
   the wizard holds; the calls live in CephDeployWizard.
*/

export type CephNodeStateName = 'absent' | 'installed' | 'initialized' | 'unknown'

export interface PreflightNode {
  node: string
  online: boolean
  address: string | null
  ceph: CephNodeStateName
  pveVersion: string | null
  repository: CephRepository
  ssh: SshVerdict | null
}

export interface Preflight {
  nodes: PreflightNode[]
  releases: CephRelease[]
}

export type InstallState = { status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'UNKNOWN'; logs: string }

export interface ConfigValues {
  node: string
  network: string
  clusterNetwork: string
  size: string
  minSize: string
  singleCopy: boolean
}

/** Why the wizard cannot go past the check, null when it can. */
export function preflightBlock(p: Preflight): 'initialized' | 'unknown' | 'ssh' | 'noNode' | null {
  const online = p.nodes.filter(n => n.online)
  if (online.length === 0) return 'noNode'
  if (online.some(n => n.ceph === 'initialized')) return 'initialized'
  if (online.some(n => n.ceph === 'unknown')) return 'unknown'
  if (online.some(n => n.ceph === 'absent' && n.ssh !== 'ok')) return 'ssh'
  return null
}

const STATE_DOT: Record<CephNodeStateName, 'ok' | 'warn' | 'error' | 'muted'> = { absent: 'muted', installed: 'ok', initialized: 'warn', unknown: 'error' }

function NodeName({ name, online }: Readonly<{ name: string; online: boolean }>) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <i className='ri-server-line' style={{ fontSize: 15, opacity: 0.7 }} aria-hidden />
      <StateDot state={online ? 'ok' : 'error'} size={7} />
      <Typography component='span' variant='body2' fontWeight={600}>{name}</Typography>
    </Box>
  )
}

export function PreflightStep({ preflight }: Readonly<{ preflight: Preflight }>) {
  const t = useTranslations('cephCockpit.provision.deploy.preflight')
  const block = preflightBlock(preflight)
  const online = preflight.nodes.filter(n => n.online)
  const sshProblem = online.find(n => n.ceph === 'absent' && n.ssh !== 'ok')
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Table size='small' sx={{ '& td, & th': { px: 1.25, whiteSpace: 'nowrap' } }}>
        <TableHead>
          <TableRow sx={{ '& th': { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'text.secondary' } }}>
            <TableCell>{t('node')}</TableCell>
            <TableCell>{t('version')}</TableCell>
            <TableCell>{t('ceph')}</TableCell>
            <TableCell>{t('ssh')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {preflight.nodes.map(n => (
            <TableRow key={n.node} data-testid='preflight-node'>
              <TableCell><NodeName name={n.node} online={n.online} /></TableCell>
              <TableCell><Typography variant='body2'>{n.pveVersion ?? '–'}</Typography></TableCell>
              <TableCell>
                {n.online ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <StateDot state={STATE_DOT[n.ceph]} size={7} />
                    <Typography variant='body2'>{t(`states.${n.ceph}`)}</Typography>
                  </Box>
                ) : <Typography variant='body2' color='text.secondary'>{t('offline')}</Typography>}
              </TableCell>
              <TableCell><Typography variant='body2' color={n.ssh === 'ok' ? 'text.primary' : 'text.secondary'}>{n.ssh ? t(`sshStates.${n.ssh}`) : '–'}</Typography></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {block === 'initialized' && <Alert severity='info'>{t('alreadyInitialized')}</Alert>}
      {block === 'unknown' && <Alert severity='error'>{t('unknownState')}</Alert>}
      {block === 'noNode' && <Alert severity='error'>{t('noNode')}</Alert>}
      {block === 'ssh' && sshProblem && <SshVerdictAlert verdict={sshProblem.ssh} />}
      {block === null && online.length < 3 && <Alert severity='warning'>{t('fewNodes', { count: online.length })}</Alert>}
      {block === null && preflight.nodes.some(n => !n.online) && <Alert severity='warning'>{t('offlineLeftOut')}</Alert>}
    </Box>
  )
}

export function InstallStep({ nodes, releases, version, repository, states, onVersion, onRepository }: Readonly<{
  nodes: string[]
  releases: CephRelease[]
  version: CephRelease
  repository: CephRepository
  states: Record<string, InstallState>
  onVersion: (v: CephRelease) => void
  onRepository: (r: CephRepository) => void
}>) {
  const t = useTranslations('cephCockpit.provision.deploy.install')
  const [openLog, setOpenLog] = useState<string | null>(null)
  const started = Object.keys(states).length > 0
  const failed = nodes.some(n => states[n]?.status === 'FAILED')
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Typography variant='body2' color='text.secondary' sx={{ mb: 0.5 }}>{t('help', { count: nodes.length })}</Typography>
      <SelectRow<CephRelease> label={t('version')} value={version} options={releases.map(r => ({ value: r, label: r }))} onChange={onVersion} disabled={started && !failed} width={180} />
      <SelectRow<CephRepository>
        label={t('repository')}
        value={repository}
        options={(['enterprise', 'no-subscription', 'manual'] as const).map(r => ({ value: r, label: t(`repositories.${r}`) }))}
        onChange={onRepository}
        disabled={started && !failed}
      />
      {nodes.map(n => {
        const s = states[n]
        return (
          <Box key={n} data-testid='install-node'>
            <FormRow label={<NodeName name={n} online />}>
              <Typography variant='body2' color={s?.status === 'FAILED' ? 'error' : 'text.secondary'}>
                {s ? t(`status.${s.status}`) : t('status.waiting')}
              </Typography>
              {s?.logs && (
                <Button size='small' color='inherit' onClick={() => setOpenLog(openLog === n ? null : n)}>{t('log')}</Button>
              )}
            </FormRow>
            <Collapse in={openLog === n} unmountOnExit>
              <Box component='pre' sx={{ m: 0, mb: 1, p: 1, maxHeight: 200, overflow: 'auto', fontFamily: 'monospace', fontSize: 12, bgcolor: 'action.hover', borderRadius: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {s?.logs}
              </Box>
            </Collapse>
          </Box>
        )
      })}
      {failed && <Alert severity='error'>{t('reposHint')}</Alert>}
    </Box>
  )
}

export function ConfigStep({ nodes, values, onChange, nodeCount }: Readonly<{
  nodes: PreflightNode[]
  values: ConfigValues
  onChange: (next: Partial<ConfigValues>) => void
  nodeCount: number
}>) {
  const t = useTranslations('cephCockpit.provision.deploy.config')
  const tp = useTranslations('cephCockpit.provision.pool')
  const networkId = useId()
  const clusterId = useId()
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Typography variant='body2' color='text.secondary' sx={{ mb: 0.5 }}>{t('help')}</Typography>
      <SelectRow label={t('monNode')} value={values.node} options={nodes.map(n => ({ value: n.node, label: n.node }))} onChange={node => onChange({ node })} />
      <FormRow label={t('network')} htmlFor={networkId}>
        <TextField id={networkId} size='small' value={values.network} onChange={e => onChange({ network: e.target.value.trim() })} placeholder='10.0.0.0/24' sx={{ width: 240 }} />
      </FormRow>
      <FormRow label={t('clusterNetwork')} htmlFor={clusterId}>
        <TextField id={clusterId} size='small' value={values.clusterNetwork} onChange={e => onChange({ clusterNetwork: e.target.value.trim() })} placeholder={t('clusterNetworkNone')} sx={{ width: 240 }} />
      </FormRow>
      <NumberRow label={t('size')} value={values.size} onChange={size => onChange({ size })} min={1} max={7} />
      <NumberRow label={t('minSize')} value={values.minSize} onChange={minSize => onChange({ minSize })} min={1} max={7} />
      {values.minSize === '1' && (
        <FormRow label=''>
          <FormControlLabel
            control={<Checkbox size='small' checked={values.singleCopy} onChange={e => onChange({ singleCopy: e.target.checked })} />}
            label={<Typography variant='body2'>{tp('singleCopy')}</Typography>}
          />
        </FormRow>
      )}
      {nodeCount < 3 && <Alert severity='warning' sx={{ mt: 1 }}>{t('fewNodes')}</Alert>}
    </Box>
  )
}

export function MonitorsStep({ nodes, picked, onToggle, created }: Readonly<{
  nodes: string[]
  picked: string[]
  onToggle: (node: string) => void
  created: string[]
}>) {
  const t = useTranslations('cephCockpit.provision.deploy.monitors')
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Typography variant='body2' color='text.secondary' sx={{ mb: 0.5 }}>{nodes.length > 0 ? t('help') : t('none')}</Typography>
      {nodes.map(n => (
        <FormControlLabel
          key={n}
          control={<Checkbox size='small' checked={picked.includes(n)} disabled={created.includes(n)} onChange={() => onToggle(n)} />}
          label={(
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <NodeName name={n} online />
              {created.includes(n) && <Typography variant='caption' color='text.secondary'>{t('done')}</Typography>}
            </Box>
          )}
        />
      ))}
    </Box>
  )
}

export function DoneStep({ cluster }: Readonly<{ cluster: string }>) {
  const t = useTranslations('cephCockpit.provision.deploy.done')
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <img src='/images/ceph-logo.svg' alt='' width={22} height={22} />
        <Typography variant='body1' fontWeight={600}>{t('title', { cluster })}</Typography>
      </Box>
      <Typography variant='body2' color='text.secondary'>{t('next')}</Typography>
    </Box>
  )
}
