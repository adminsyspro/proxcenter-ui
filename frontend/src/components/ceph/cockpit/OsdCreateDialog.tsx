'use client'

import { useEffect, useId, useState } from 'react'
import { Box, Button, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, FormControlLabel, MenuItem, Switch, TextField, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import { useToast } from '@/contexts/ToastContext'
import type { FreeDisk } from '@/lib/ceph/freeDisks'
import { binaryUnit } from '@/lib/ceph/overview'
import { cephDisksUrl, cephOsdCreateUrl } from '@/lib/ceph/provisionClient'
import { useCephTask } from './hooks/useCephTask'
import { FormRow, NumberRow, SMALL_SELECT_SX } from './provisionUi'
import { ProvisionFailureAlert, SshVerdictAlert, TaskFollowing, type SshVerdict } from './provisionTask'

/*
   Creation of an OSD on a free disk (ui#1450). The node picked, the dialog
   reads its free disks and whether the SSH account may run
   `pveceph osd create` there (one read, GET .../ceph/disks). The DB and WAL
   devices, the encryption and the device class sit behind "Advanced options".
   pveceph runs over SSH: PVE refuses OSD creation to an API token.
*/

export interface OsdCreateDialogProps {
  open: boolean
  connId: string
  /** The PVE nodes of the cluster. */
  nodes: string[]
  onClose: () => void
  onDone: () => void
}

type DiskRead = { state: 'loading' } | { state: 'ready'; disks: FreeDisk[]; ssh: SshVerdict } | { state: 'error'; error: string }

function useNodeDisks(connId: string, node: string): DiskRead {
  // Keyed by node: a read of the previous node is no answer for this one (no reset inside the effect).
  const [read, setRead] = useState<{ node: string; read: DiskRead } | null>(null)
  useEffect(() => {
    if (!node) return
    let live = true
    fetch(cephDisksUrl(connId, node))
      .then(async res => {
        const json = await res.json().catch(() => ({}))
        if (!live) return
        if (res.ok) setRead({ node, read: { state: 'ready', disks: json?.data?.disks ?? [], ssh: json?.data?.ssh ?? 'unreachable' } })
        else setRead({ node, read: { state: 'error', error: json?.error || `HTTP ${res.status}` } })
      })
      .catch((e: Error) => { if (live) setRead({ node, read: { state: 'error', error: e.message } }) })
    return () => { live = false }
  }, [connId, node])
  return read && read.node === node ? read.read : { state: 'loading' }
}

export default function OsdCreateDialog({ open, connId, nodes, onClose, onDone }: Readonly<OsdCreateDialogProps>) {
  const t = useTranslations('cephCockpit.provision.osd')
  const tc = useTranslations('common')
  const format = useFormatter()
  const toast = useToast()
  const task = useCephTask(connId)
  const nodeLabel = useId()
  const diskLabel = useId()
  const classId = useId()

  const [node, setNode] = useState(nodes[0] ?? '')
  const [devPick, setDev] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [dbPick, setDbDev] = useState('')
  const [dbSize, setDbSize] = useState('')
  const [walPick, setWalDev] = useState('')
  const [walSize, setWalSize] = useState('')
  const [encrypted, setEncrypted] = useState(false)
  const [deviceClass, setDeviceClass] = useState('')
  const read = useNodeDisks(connId, node)
  const disks = read.state === 'ready' ? read.disks : []

  // A disk of the previous node is no choice on this one: a pick counts only while the node offers it.
  const offered = (path: string) => disks.some(d => d.devpath === path)
  const dev = offered(devPick) ? devPick : (disks[0]?.devpath ?? '')
  const dbDev = offered(dbPick) && dbPick !== dev ? dbPick : ''
  const walDev = offered(walPick) && walPick !== dev && walPick !== dbDev ? walPick : ''

  const size = (n: number) => {
    const unit = binaryUnit(n)
    return `${format.number(n / unit.divisor, { maximumFractionDigits: 1 })} ${unit.unit}`
  }
  const diskText = (d: FreeDisk) => `${d.devpath} · ${size(d.sizeBytes)}${d.model ? ` · ${d.model}` : ''}`

  const sizeOk = (s: string, devPicked: string) => s === '' || (devPicked !== '' && Number.isInteger(Number(s)) && Number(s) >= 1)
  const classOk = deviceClass === '' || /^[a-z0-9_-]{1,32}$/.test(deviceClass)
  const canRun = read.state === 'ready' && read.ssh === 'ok' && dev !== ''
  const valid = canRun && sizeOk(dbSize, dbDev) && sizeOk(walSize, walDev) && classOk

  const close = () => {
    task.clear()
    onClose()
  }

  const submit = async () => {
    if (!valid) return
    const body: Record<string, unknown> = { dev, encrypted }
    if (dbDev) body.dbDev = dbDev
    if (dbDev && dbSize) body.dbSizeGiB = Number(dbSize)
    if (walDev) body.walDev = walDev
    if (walDev && walSize) body.walSizeGiB = Number(walSize)
    if (deviceClass) body.deviceClass = deviceClass
    const outcome = await task.run(cephOsdCreateUrl(connId, node), 'POST', body)
    if (!('result' in outcome)) return
    if (outcome.result.pending) toast.info(t('pending', { node }))
    else toast.success(t('created', { node, dev }))
    onDone()
    onClose()
  }

  const sideOptions = (exclude: string[]) => [
    <MenuItem key='' value=''>{t('none')}</MenuItem>,
    ...disks.filter(d => !exclude.includes(d.devpath)).map(d => <MenuItem key={d.devpath} value={d.devpath}>{diskText(d)}</MenuItem>),
  ]

  return (
    <Dialog open={open} onClose={close} maxWidth='sm' fullWidth>
      <AppDialogTitle icon={<i className='ri-hard-drive-2-line' style={{ fontSize: 20 }} aria-hidden />} onClose={close}>
        {t('createTitle')}
      </AppDialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <FormRow label={t('node')} labelId={nodeLabel}>
          <TextField
            select
            size='small'
            value={node}
            onChange={e => setNode(e.target.value)}
            slotProps={{ select: { labelId: nodeLabel, SelectDisplayProps: { 'aria-labelledby': nodeLabel } as object } }}
            sx={{ width: 240, ...SMALL_SELECT_SX }}
          >
            {nodes.map(n => (
              <MenuItem key={n} value={n}>
                <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                  <i className='ri-server-line' style={{ fontSize: 15, opacity: 0.7 }} aria-hidden />{n}
                </Box>
              </MenuItem>
            ))}
          </TextField>
        </FormRow>
        <FormRow label={t('disk')} labelId={diskLabel}>
          {read.state === 'loading' && <CircularProgress size={16} />}
          {read.state === 'error' && <Typography variant='body2' color='error'>{read.error}</Typography>}
          {read.state === 'ready' && disks.length === 0 && <Typography variant='body2' color='text.secondary'>{t('noFreeDisk')}</Typography>}
          {read.state === 'ready' && disks.length > 0 && (
            <TextField
              select
              size='small'
              value={dev}
              onChange={e => setDev(e.target.value)}
              slotProps={{ select: { labelId: diskLabel, SelectDisplayProps: { 'aria-labelledby': diskLabel } as object } }}
              sx={{ width: 340, ...SMALL_SELECT_SX }}
            >
              {disks.map(d => (
                <MenuItem key={d.devpath} value={d.devpath}>
                  <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                    <i className='ri-hard-drive-2-line' style={{ fontSize: 15, opacity: 0.7 }} aria-hidden />{diskText(d)}
                  </Box>
                </MenuItem>
              ))}
            </TextField>
          )}
        </FormRow>

        <Box>
          <Button size='small' color='inherit' onClick={() => setAdvanced(a => !a)} startIcon={<i className={advanced ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />}>
            {t('advanced')}
          </Button>
        </Box>
        <Collapse in={advanced} unmountOnExit>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <FormRow label={t('dbDevice')}>
              <TextField select size='small' value={dbDev} onChange={e => setDbDev(e.target.value)} slotProps={{ select: { displayEmpty: true } }} sx={{ width: 340, ...SMALL_SELECT_SX }}>
                {sideOptions([dev, walDev])}
              </TextField>
            </FormRow>
            {dbDev && <NumberRow label={t('dbSize')} value={dbSize} onChange={setDbSize} min={1} suffix={<Typography variant='body2' color='text.secondary'>GiB</Typography>} />}
            <FormRow label={t('walDevice')}>
              <TextField select size='small' value={walDev} onChange={e => setWalDev(e.target.value)} slotProps={{ select: { displayEmpty: true } }} sx={{ width: 340, ...SMALL_SELECT_SX }}>
                {sideOptions([dev, dbDev])}
              </TextField>
            </FormRow>
            {walDev && <NumberRow label={t('walSize')} value={walSize} onChange={setWalSize} min={1} suffix={<Typography variant='body2' color='text.secondary'>GiB</Typography>} />}
            <FormRow label={t('deviceClass')} htmlFor={classId}>
              <TextField id={classId} size='small' value={deviceClass} onChange={e => setDeviceClass(e.target.value.trim())} error={!classOk} placeholder={t('deviceClassAuto')} sx={{ width: 160 }} />
            </FormRow>
            <FormRow label=''>
              <FormControlLabel control={<Switch size='small' checked={encrypted} onChange={e => setEncrypted(e.target.checked)} />} label={<Typography variant='body2'>{t('encrypted')}</Typography>} />
            </FormRow>
            {dbSize === '' && dbDev && <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{t('dbSizeAuto')}</Typography>}
          </Box>
        </Collapse>

        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 0.5 }}>{t('wipeNote')}</Typography>
        <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {read.state === 'ready' && <SshVerdictAlert verdict={read.ssh} />}
          {task.phase === 'following' && <TaskFollowing />}
          {task.failure && <ProvisionFailureAlert failure={task.failure} />}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={close} color='inherit'>{tc('cancel')}</Button>
        <Button
          variant='contained'
          disabled={!valid || task.busy}
          startIcon={task.busy ? <CircularProgress size={16} /> : <i className='ri-add-line' />}
          onClick={() => void submit()}
        >
          {t('create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
