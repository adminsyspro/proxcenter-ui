'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, Step, StepLabel, Stepper } from '@mui/material'
import { useTranslations } from 'next-intl'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import { useToast } from '@/contexts/ToastContext'
import { publicNetworkOf } from '@/lib/ceph/deployPreflight'
import type { CephRelease, CephRepository } from '@/lib/ceph/pvecephCommands'
import { cephCreateUrl } from '@/lib/ceph/serviceClient'
import type { CockpitConnection } from './CephCockpit'
import { useCephTask } from './hooks/useCephTask'
import OsdCreateDialog from './OsdCreateDialog'
import PoolFormDialog from './PoolFormDialog'
import { ProvisionFailureAlert, TaskFollowing } from './provisionTask'
import { SelectRow } from './provisionUi'
import { ConfigStep, DoneStep, InstallStep, MonitorsStep, PreflightStep, preflightBlock, type ConfigValues, type InstallState, type Preflight } from './deploy/steps'

/*
   Deploy Ceph on a Proxmox VE cluster that runs none (ui#1450), in five steps:
   check the nodes, install the packages where they are missing (pveceph over
   SSH, no API for it), initialize and create the first monitor (PVE API),
   add two more monitors, then point to the OSDs and the first pool. Each
   write is followed to the end of its PVE task. Init flags the connection as
   running Ceph: onInitialized lets the cockpit list it at once.
*/

type StepId = 'preflight' | 'install' | 'config' | 'monitors' | 'done'
const STEPS: StepId[] = ['preflight', 'install', 'config', 'monitors', 'done']
const POLL_MS = 3000

export interface CephDeployWizardProps {
  open: boolean
  /** The PVE connections without Ceph. */
  candidates: CockpitConnection[]
  initialId?: string
  onClose: () => void
  /** Ceph was initialized on this connection. */
  onInitialized: (connId: string) => void
  /** Open the cockpit on the new cluster. */
  onOpenCluster: (connId: string) => void
}

const enc = encodeURIComponent

export default function CephDeployWizard({ open, candidates, initialId, onClose, onInitialized, onOpenCluster }: Readonly<CephDeployWizardProps>) {
  const t = useTranslations('cephCockpit.provision.deploy')
  const tc = useTranslations('common')
  const toast = useToast()
  const [connId, setConnId] = useState(initialId ?? candidates[0]?.id ?? '')
  // Once initialized, the cluster leaves the candidates (it has Ceph now): keep the name it had.
  const [knownNames, setKnownNames] = useState<Record<string, string>>(() => Object.fromEntries(candidates.map(c => [c.id, c.name])))
  const listedName = candidates.find(c => c.id === connId)?.name
  if (listedName && knownNames[connId] !== listedName) setKnownNames(n => ({ ...n, [connId]: listedName }))
  const cluster = listedName ?? knownNames[connId] ?? connId
  const task = useCephTask(connId)

  const [step, setStep] = useState<StepId>('preflight')
  // Keyed by connection: the read of another cluster is no answer for this one (no reset inside the effect).
  const [read, setRead] = useState<{ id: string; preflight: Preflight | null; error: string | null } | null>(null)
  const preflight = read?.id === connId ? read.preflight : null
  const preflightError = read?.id === connId ? read.error : null
  const [version, setVersion] = useState<CephRelease>('tentacle')
  const [repository, setRepository] = useState<CephRepository>('no-subscription')
  const [installs, setInstalls] = useState<Record<string, InstallState>>({})
  const [config, setConfig] = useState<ConfigValues>({ node: '', network: '', clusterNetwork: '', size: '3', minSize: '2', singleCopy: false })
  const [monPicked, setMonPicked] = useState<string[]>([])
  const [monCreated, setMonCreated] = useState<string[]>([])
  const [extra, setExtra] = useState<'osd' | 'pool' | null>(null)
  const alive = useRef(true)
  // Mounted again after a StrictMode or Fast Refresh unmount: the flag is set back here, not only at creation.
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const online = useMemo(() => (preflight?.nodes ?? []).filter(n => n.online), [preflight])
  const toInstall = useMemo(() => online.filter(n => n.ceph === 'absent').map(n => n.node), [online])
  const otherNodes = online.filter(n => n.node !== config.node).map(n => n.node)

  // The check, on opening and on another cluster.
  useEffect(() => {
    if (!connId) return
    let live = true
    fetch(`/api/v1/connections/${enc(connId)}/ceph/preflight`)
      .then(async res => {
        const json = await res.json().catch(() => ({}))
        if (!live) return
        if (!res.ok) return setRead({ id: connId, preflight: null, error: json?.error || `HTTP ${res.status}` })
        const p = json?.data as Preflight | undefined
        if (!p || !Array.isArray(p.nodes) || !Array.isArray(p.releases)) return setRead({ id: connId, preflight: null, error: t('preflight.unreadable') })
        setRead({ id: connId, preflight: p, error: null })
        setVersion(p.releases[0] ?? 'tentacle')
        const absent = p.nodes.filter(n => n.online && n.ceph === 'absent')
        setRepository(absent.length > 0 && absent.every(n => n.repository === 'enterprise') ? 'enterprise' : 'no-subscription')
        const first = p.nodes.find(n => n.online)
        setConfig(c => ({ ...c, node: first?.node ?? '', network: publicNetworkOf(first?.address) }))
      })
      .catch((e: Error) => { if (live) setRead({ id: connId, preflight: null, error: e.message }) })
    return () => { live = false }
  }, [connId, t])

  // Install progress: one read right after the start, then every 3 s while a node is still installing.
  const pollInstall = useCallback((nodes: string[]) => {
    for (const n of nodes) {
      fetch(`/api/v1/connections/${enc(connId)}/nodes/${enc(n)}/ceph/install`)
        .then(r => r.json())
        .then(json => {
          const next = json?.data as InstallState | undefined
          // A log not written yet reads UNKNOWN: the run was started, so it is still running.
          if (next && alive.current) setInstalls(s => ({ ...s, [n]: next.status === 'UNKNOWN' ? { ...next, status: 'RUNNING' } : next }))
        })
        .catch(() => {})
    }
  }, [connId])

  const running = toInstall.filter(n => installs[n]?.status === 'RUNNING')
  const installing = running.length > 0
  const runningKey = running.join(',')
  useEffect(() => {
    if (!runningKey) return
    const timer = setInterval(() => pollInstall(runningKey.split(',')), POLL_MS)
    return () => clearInterval(timer)
  }, [runningKey, pollInstall])

  const startInstall = async () => {
    const started: Record<string, InstallState> = {}
    for (const n of toInstall) {
      if (installs[n]?.status === 'COMPLETED') continue
      const res = await fetch(`/api/v1/connections/${enc(connId)}/nodes/${enc(n)}/ceph/install`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, repository }),
      }).catch(() => null)
      const json = res ? await res.json().catch(() => ({})) : {}
      started[n] = res?.ok ? { status: 'RUNNING', logs: '' } : { status: 'FAILED', logs: json?.error || 'Network error' }
    }
    setInstalls(s => ({ ...s, ...started }))
    pollInstall(Object.keys(started).filter(n => started[n].status === 'RUNNING'))
  }

  const initialize = async () => {
    const body = {
      node: config.node,
      network: config.network,
      ...(config.clusterNetwork ? { clusterNetwork: config.clusterNetwork } : {}),
      size: Number(config.size),
      minSize: Number(config.minSize),
      allowSingleCopy: config.minSize === '1' && config.singleCopy,
    }
    const outcome = await task.run(`/api/v1/connections/${enc(connId)}/ceph/init`, 'POST', body)
    if (!('result' in outcome)) return
    onInitialized(connId)
    setMonPicked(otherNodes.length >= 2 ? otherNodes.slice(0, 2) : [])
    setStep('monitors')
  }

  const createMonitors = async () => {
    for (const n of monPicked.filter(m => !monCreated.includes(m))) {
      for (const kind of ['mon', 'mgr'] as const) {
        const outcome = await task.run(cephCreateUrl(connId, n), 'POST', { kind })
        if (!('result' in outcome)) return
      }
      setMonCreated(c => [...c, n])
      toast.success(t('monitors.created', { node: n }))
    }
    setStep('done')
  }

  const block = preflight ? preflightBlock(preflight) : null
  const installDone = toInstall.every(n => installs[n]?.status === 'COMPLETED')
  const configValid = !!config.node && /\//.test(config.network) && Number(config.minSize) >= 1 && Number(config.minSize) <= Number(config.size) && (config.minSize !== '1' || config.singleCopy)

  const goNext = useCallback(() => {
    if (step === 'preflight') setStep(toInstall.length > 0 ? 'install' : 'config')
    else if (step === 'install') setStep('config')
  }, [step, toInstall.length])

  const shown = STEPS.filter(s => s !== 'install' || toInstall.length > 0)
  const close = () => { if (!task.busy) onClose() }

  let actions: ReactNode
  if (step === 'preflight') actions = <Button variant='contained' disabled={!preflight || block !== null} onClick={goNext}>{tc('next')}</Button>
  else if (step === 'install') {
    actions = (
      <>
        {!installDone && (
          <Button
            variant='outlined'
            disabled={installing}
            startIcon={installing ? <CircularProgress size={16} /> : <i className='ri-download-2-line' />}
            onClick={() => void startInstall()}
          >
            {Object.keys(installs).length > 0 ? t('install.retry') : t('install.start')}
          </Button>
        )}
        <Button variant='contained' disabled={!installDone} onClick={goNext}>{tc('next')}</Button>
      </>
    )
  } else if (step === 'config') {
    actions = (
      <Button variant='contained' disabled={!configValid || task.busy} startIcon={task.busy ? <CircularProgress size={16} /> : <i className='ri-play-line' />} onClick={() => void initialize()}>
        {t('config.init')}
      </Button>
    )
  } else if (step === 'monitors') {
    actions = (
      <>
        <Button color='inherit' disabled={task.busy} onClick={() => setStep('done')}>{t('monitors.skip')}</Button>
        <Button variant='contained' disabled={monPicked.length === 0 || task.busy} startIcon={task.busy ? <CircularProgress size={16} /> : undefined} onClick={() => void createMonitors()}>
          {t('monitors.create')}
        </Button>
      </>
    )
  } else {
    actions = (
      <>
        <Button variant='outlined' onClick={() => setExtra('osd')} startIcon={<i className='ri-hard-drive-2-line' />}>{t('done.addOsd')}</Button>
        <Button variant='outlined' onClick={() => setExtra('pool')} startIcon={<i className='ri-database-2-line' />}>{t('done.createPool')}</Button>
        <Button variant='contained' onClick={() => { onOpenCluster(connId); onClose() }}>{t('done.open')}</Button>
      </>
    )
  }

  return (
    <>
      <Dialog open={open && extra === null} onClose={close} maxWidth='md' fullWidth>
        <AppDialogTitle icon={<img src='/images/ceph-logo.svg' alt='' width={20} height={20} />} onClose={close}>
          {t('titleOn', { cluster })}
        </AppDialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Stepper activeStep={shown.indexOf(step)} alternativeLabel>
            {shown.map(s => <Step key={s}><StepLabel>{t(`steps.${s}`)}</StepLabel></Step>)}
          </Stepper>
          {step === 'preflight' && candidates.length > 1 && (
            <SelectRow label={t('cluster')} value={connId} options={candidates.map(c => ({ value: c.id, label: c.name }))} onChange={id => { setConnId(id); setStep('preflight'); setInstalls({}) }} />
          )}
          {step === 'preflight' && !preflight && !preflightError && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}><CircularProgress size={16} />{t('preflight.loading')}</Box>
          )}
          {preflightError && <Alert severity='error'>{preflightError}</Alert>}
          {step === 'preflight' && preflight && <PreflightStep preflight={preflight} />}
          {step === 'install' && preflight && (
            <InstallStep nodes={toInstall} releases={preflight.releases} version={version} repository={repository} states={installs} onVersion={setVersion} onRepository={setRepository} />
          )}
          {step === 'config' && (
            <ConfigStep
              nodes={online}
              values={config}
              nodeCount={online.length}
              onChange={next => setConfig(c => {
                const merged = { ...c, ...next }
                // Another first monitor: propose its network, unless one was typed.
                if (next.node && c.network === publicNetworkOf(online.find(n => n.node === c.node)?.address)) {
                  merged.network = publicNetworkOf(online.find(n => n.node === next.node)?.address)
                }
                return merged
              })}
            />
          )}
          {step === 'monitors' && (
            <MonitorsStep nodes={otherNodes} picked={monPicked} created={monCreated} onToggle={n => setMonPicked(p => (p.includes(n) ? p.filter(x => x !== n) : [...p, n]))} />
          )}
          {step === 'done' && <DoneStep cluster={cluster} />}
          {task.phase === 'following' && <TaskFollowing />}
          {task.failure && <ProvisionFailureAlert failure={task.failure} />}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button color='inherit' onClick={close} sx={{ mr: 'auto' }}>{tc('close')}</Button>
          {actions}
        </DialogActions>
      </Dialog>
      {extra === 'osd' && (
        <OsdCreateDialog open connId={connId} nodes={online.map(n => n.node)} onClose={() => setExtra(null)} onDone={() => {}} />
      )}
      {extra === 'pool' && (
        <PoolFormDialog open mode='create' connId={connId} crushRules={[]} onClose={() => setExtra(null)} onDone={() => {}} />
      )}
    </>
  )
}
