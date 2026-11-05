'use client'

import React, { useEffect, useRef, useState } from 'react'

import { useTranslations } from 'next-intl'

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'

import { SMALL_SELECT_SX } from '@/components/settings/VdcQuotaRow'
import {
  asText,
  BWLIMIT_KINDS,
  parseBwlimit,
  STORAGE_ID_RE,
  STORAGE_TYPE_SPECS,
  type BwlimitMiB,
  type ClusterStorageType,
  type StorageField,
} from '@/lib/storage/clusterStorageTypes'

/** Every type of the Add dialog, PBS included, with its glyph. */
export const ADD_STORAGE_TYPES: Array<{ value: ClusterStorageType | 'pbs'; icon: string }> = [
  { value: 'nfs', icon: 'ri-folder-shared-line' },
  { value: 'cifs', icon: 'ri-folder-shared-line' },
  { value: 'iscsi', icon: 'ri-hard-drive-3-line' },
  { value: 'lvm', icon: 'ri-stack-line' },
  { value: 'rbd', icon: 'ri-database-2-line' },
  { value: 'cephfs', icon: 'ri-folders-line' },
  { value: 'zfs', icon: 'ri-hard-drive-3-line' },
  { value: 'dir', icon: 'ri-folder-line' },
  { value: 'pbs', icon: 'ri-hard-drive-2-fill' },
]

/** The last field a scan reads, per type: the test sits right below it. */
const SCAN_AFTER: Partial<Record<ClusterStorageType, string>> = { nfs: 'server', cifs: 'domain', iscsi: 'portal', zfs: 'portal', lvm: 'base' }

/** The field a scan fills, per type. */
const SCANNED_FIELD: Partial<Record<ClusterStorageType, string>> = { nfs: 'export', cifs: 'share', iscsi: 'target', zfs: 'target', lvm: 'vgname' }

type ScanEntry = { value: string; detail: string | null }
type Props = {
  cluster: { id: string; name?: string | null }
  mode: 'create' | 'edit'
  /** Edit: the storage to edit. */
  storage?: string
  /** Create: the type picked in the Add dialog. */
  initialType?: ClusterStorageType
  /** Create: the operator picked another type (PBS has its own dialog). */
  onTypeChange?: (type: string) => void
  onClose: () => void
  onSaved: () => void
}

/** One line: the glyph then the label. */
export function OptionRow({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Box component='i' className={icon} sx={{ fontSize: 16, opacity: 0.8, flexShrink: 0 }} />
      {children}
    </Box>
  )
}

const asList = (raw: unknown) => asText(raw).split(',').map(s => s.trim()).filter(Boolean)
const byName = (a: string, b: string) => a.localeCompare(b)

/** `data` of a ProxCenter API answer, or its error. */
async function getData<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const json = await res.json().catch(() => ({}))

  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)

  return json?.data as T
}

/**
 * Nodes and storages of the cluster: the node lists, the names already taken,
 * and the iSCSI storages an LVM can be built on.
 */
function useClusterLists(base: string) {
  const [lists, setLists] = useState({ nodes: [] as string[], taken: [] as string[], iscsi: [] as string[] })

  useEffect(() => {
    let alive = true
    const load = async () => {
      const [nodes, storages] = await Promise.all([
        getData<any[]>(`${base}/nodes`).catch(() => []),
        getData<any[]>(`${base}/storage`).catch(() => []),
      ])
      const rows = Array.isArray(storages) ? storages : []

      if (!alive) return
      setLists({
        nodes: (Array.isArray(nodes) ? nodes : []).map((n: any) => String(n?.node)).filter(Boolean).sort(byName),
        taken: rows.map((s: any) => String(s.storage)),
        iscsi: [...new Set<string>(rows.filter((s: any) => s.type === 'iscsi').map((s: any) => String(s.storage)))].sort(byName),
      })
    }

    void load()

    return () => { alive = false }
  }, [base])

  return lists
}

/** The edit form a stored configuration fills in. */
type StoredForm = {
  type: ClusterStorageType
  fields: Record<string, string | boolean>
  content: string[]
  nodes: string[]
  enabled: boolean
  shared: boolean
  bwlimit: BwlimitMiB
  baseStorage: string
}

export function formFromConfig(cfg: Record<string, any>): StoredForm {
  const type = cfg.type as ClusterStorageType
  const fields: Record<string, string | boolean> = {}

  for (const f of STORAGE_TYPE_SPECS[type]?.fields ?? []) {
    if (cfg[f.key] === undefined) continue
    fields[f.key] = f.kind === 'boolean' ? cfg[f.key] === 1 || cfg[f.key] === '1' : asText(cfg[f.key])
  }

  return {
    type,
    fields,
    content: asList(cfg.content),
    nodes: asList(cfg.nodes),
    enabled: !cfg.disable,
    shared: cfg.shared === 1 || cfg.shared === '1',
    bwlimit: parseBwlimit(cfg.bwlimit),
    baseStorage: cfg.base ? asText(cfg.base).split(':')[0] : '',
  }
}

/** Edit: the stored configuration (secrets left out by the route), handed to `apply` once. */
function useStoredConfig(url: string | null, apply: (form: StoredForm) => void) {
  const applyRef = useRef(apply)
  const [state, setState] = useState({ loading: !!url, error: null as string | null })

  applyRef.current = apply

  useEffect(() => {
    if (!url) return
    let alive = true
    const load = async () => {
      try {
        const cfg = await getData<Record<string, any>>(url)

        if (!alive) return
        applyRef.current(formFromConfig(cfg))
        setState({ loading: false, error: null })
      } catch (e: any) {
        if (alive) setState({ loading: false, error: e?.message || String(e) })
      }
    }

    void load()

    return () => { alive = false }
  }, [url])

  return state
}

/** LVM on iSCSI: the LUNs of the chosen base storage, read from one node. */
function useLuns(url: string | null) {
  const [luns, setLuns] = useState<ScanEntry[]>([])

  useEffect(() => {
    if (!url) return
    let alive = true
    const load = async () => {
      const rows = await getData<any[]>(url).catch(() => [])
      const lunSize = (v: any) => (v.size ? `${Math.round(Number(v.size) / 2 ** 30)} GiB` : null)

      if (alive) setLuns((Array.isArray(rows) ? rows : []).map((v: any) => ({ value: String(v.volid), detail: lunSize(v) })))
    }

    void load()

    return () => { alive = false }
  }, [url])

  return luns
}

/**
 * Add or edit a cluster storage (roadmap#202): NFS, SMB/CIFS, iSCSI, LVM,
 * external RBD and CephFS, ZFS over iSCSI, Directory. The target is tested
 * from a node before saving where Proxmox has a scan for it; secrets are typed
 * in, never shown back.
 */
export default function ClusterStorageDialog({ cluster, mode, storage, initialType = 'nfs', onTypeChange, onClose, onSaved }: Readonly<Props>) {
  const t = useTranslations()
  const [type, setType] = useState<ClusterStorageType>(initialType)
  const [storageId, setStorageId] = useState(storage || '')
  const [fields, setFields] = useState<Record<string, string | boolean>>({})
  const [content, setContent] = useState<string[]>([STORAGE_TYPE_SPECS[initialType].contents[0]])
  const [nodes, setNodes] = useState<string[]>([])
  const [enabled, setEnabled] = useState(true)
  const [shared, setShared] = useState(false)
  const [bwlimit, setBwlimit] = useState<BwlimitMiB>({})
  const [bwOpen, setBwOpen] = useState(false)
  const [baseStorage, setBaseStorage] = useState('')

  const [pickedScanNode, setScanNode] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scan, setScan] = useState<{ ok: boolean; entries: ScanEntry[]; error?: string } | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const spec = STORAGE_TYPE_SPECS[type]
  const base = `/api/v1/connections/${encodeURIComponent(cluster.id)}`
  const { nodes: clusterNodes, taken, iscsi: iscsiStorages } = useClusterLists(base)
  const scanNode = pickedScanNode || clusterNodes[0] || ''

  const { loading, error: loadError } = useStoredConfig(
    mode === 'edit' && storage ? `${base}/storage/${encodeURIComponent(storage)}` : null,
    form => {
      setType(form.type)
      setFields(form.fields)
      setContent(form.content)
      setNodes(form.nodes)
      setEnabled(form.enabled)
      setShared(form.shared)
      setBwlimit(form.bwlimit)
      setBaseStorage(form.baseStorage)
    },
  )

  const luns = useLuns(type === 'lvm' && baseStorage && scanNode && mode === 'create'
    ? `${base}/nodes/${encodeURIComponent(scanNode)}/storage/${encodeURIComponent(baseStorage)}/content`
    : null)

  const pickType = (next: string) => {
    if (next === 'pbs') return onTypeChange?.('pbs')
    const nextType = next as ClusterStorageType
    setType(nextType)
    setFields({})
    setContent([STORAGE_TYPE_SPECS[nextType].contents[0]])
    setShared(false)
    setScan(null)
    setBaseStorage('')
    onTypeChange?.(nextType)
  }

  const setField = (key: string, value: string | boolean) => setFields(prev => ({ ...prev, [key]: value }))

  const holds = (cond?: { key: string; value: string }) => !!cond && asText(fields[cond.key]) === cond.value
  const visible = (f: StorageField) => !f.shownWhen || holds(f.shownWhen)
  const missing = mode === 'create' && spec.fields.some(f => visible(f) && (f.required || holds(f.requiredWhen)) && !asText(fields[f.key]).trim())
  const idInvalid = mode === 'create' && storageId !== '' && !STORAGE_ID_RE.test(storageId)
  const nameTaken = mode === 'create' && taken.includes(storageId)
  let idHelp: string | undefined
  if (nameTaken) idHelp = t('storage.attachPbs.nameTaken')
  else if (idInvalid) idHelp = t('storage.clusterStorage.storageIdHelp')
  // `none` (iSCSI kept for an LVM) excludes the rest, and the rest excludes it.
  const pickContent = (v: string[]) => setContent(v.includes('none') && !content.includes('none') ? ['none'] : v.filter(c => c !== 'none'))
  const canSubmit = !submitting && !loading && !loadError && content.length > 0 && !missing &&
    (mode === 'edit' || (STORAGE_ID_RE.test(storageId) && !nameTaken))

  const runScan = async () => {
    if (!spec.scan) return
    setScanning(true)
    setScan(null)
    try {
      const body: Record<string, unknown> = { type: spec.scan }
      if (spec.scan === 'nfs' || spec.scan === 'cifs') body.server = fields.server
      if (spec.scan === 'cifs') Object.assign(body, { username: fields.username, password: fields.password, domain: fields.domain })
      if (spec.scan === 'iscsi') body.portal = fields.portal
      const res = await fetch(`${base}/nodes/${encodeURIComponent(scanNode)}/storage-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      setScan(res.ok ? { ok: true, entries: json.data || [] } : { ok: false, entries: [], error: json?.error || `HTTP ${res.status}` })
    } catch (e: any) {
      setScan({ ok: false, entries: [], error: e?.message || String(e) })
    } finally {
      setScanning(false)
    }
  }

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    const payload = { type, storage: storageId, fields, content, nodes, enabled, shared: spec.sharedChoice ? shared : undefined, bwlimit }
    try {
      const res = mode === 'create'
        ? await fetch(`${base}/storage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch(`${base}/storage/${encodeURIComponent(storage!)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const label = (key: string) => t(`storage.clusterStorage.fields.${key}` as any)
  const scanned = SCANNED_FIELD[type]
  const scanOptions = scan?.ok ? scan.entries : []

  const renderSelect = (f: StorageField, disabled: boolean) => (
    <FormControl key={f.key} size='small' fullWidth disabled={disabled}>
      <InputLabel id={`cs-${f.key}-label`}>{label(f.key)}</InputLabel>
      <Select
        labelId={`cs-${f.key}-label`}
        label={label(f.key)}
        value={asText(fields[f.key]) || (f.key === 'smbversion' ? 'default' : '')}
        onChange={e => setField(f.key, String(e.target.value))}
        sx={SMALL_SELECT_SX}
      >
        {(f.options ?? []).map(o => (
          <MenuItem key={o} value={o}>{o === 'default' ? t('common.default') : o}</MenuItem>
        ))}
      </Select>
    </FormControl>
  )

  const renderText = (f: StorageField, disabled: boolean) => {
    const secret = f.kind === 'secret'
    const keyring = f.key === 'keyring'

    return (
      <TextField
        key={f.key}
        size='small'
        fullWidth
        required={mode === 'create' && f.required}
        disabled={disabled}
        type={secret && !keyring ? 'password' : 'text'}
        autoComplete={secret ? 'new-password' : 'off'}
        multiline={keyring}
        minRows={keyring ? 2 : undefined}
        label={label(f.key)}
        placeholder={secret && mode === 'edit' ? t('storage.clusterStorage.secretKeep') : undefined}
        value={asText(fields[f.key])}
        onChange={e => setField(f.key, e.target.value)}
      />
    )
  }

  // A scanned volume group only exists without a base: built on a LUN, the
  // group is new and named here.
  const isScanned = (f: StorageField) => f.key === scanned && !(type === 'lvm' && baseStorage)

  const renderField = (f: StorageField) => {
    if (!visible(f)) return null
    const disabled = submitting || (mode === 'edit' && !!f.fixed)

    if (f.key === 'base') return renderBase(disabled)
    if (isScanned(f)) {
      return (
        <Autocomplete
          key={f.key}
          freeSolo
          size='small'
          disabled={disabled}
          options={scanOptions.map(e => e.value)}
          inputValue={asText(fields[f.key])}
          onInputChange={(_e, v) => setField(f.key, v)}
          renderInput={params => <TextField {...params} required={f.required} label={label(f.key)} />}
        />
      )
    }
    if (f.kind === 'boolean') {
      return (
        <FormControlLabel
          key={f.key}
          control={<Checkbox size='small' checked={fields[f.key] === true} onChange={e => setField(f.key, e.target.checked)} disabled={disabled} />}
          label={label(f.key)}
        />
      )
    }

    return f.kind === 'select' ? renderSelect(f, disabled) : renderText(f, disabled)
  }

  const renderBase = (disabled: boolean) => (
    <React.Fragment key='base'>
      <FormControl size='small' fullWidth disabled={disabled}>
        <InputLabel id='cs-base-storage-label'>{label('baseStorage')}</InputLabel>
        <Select
          labelId='cs-base-storage-label'
          label={label('baseStorage')}
          value={baseStorage}
          onChange={e => { setBaseStorage(String(e.target.value)); setField('base', '') }}
          displayEmpty
          sx={SMALL_SELECT_SX}
        >
          <MenuItem value=''><em>{label('baseNone')}</em></MenuItem>
          {iscsiStorages.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
        </Select>
      </FormControl>
      {baseStorage && (
        <FormControl size='small' fullWidth disabled={disabled}>
          <InputLabel id='cs-base-label'>{label('base')}</InputLabel>
          <Select
            labelId='cs-base-label'
            label={label('base')}
            value={String(fields.base ?? '')}
            onChange={e => setField('base', String(e.target.value))}
            sx={SMALL_SELECT_SX}
          >
            {mode === 'edit' && fields.base && <MenuItem value={String(fields.base)}>{String(fields.base)}</MenuItem>}
            {luns.map(l => (
              <MenuItem key={l.value} value={l.value}>
                <ListItemText primary={l.value.split(':')[1] || l.value} secondary={l.detail} sx={{ my: 0 }} />
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
    </React.Fragment>
  )

  const multiSelect = (id: string, labelText: string, value: string[], options: string[], onChange: (v: string[]) => void, empty: string, render: (v: string) => string = v => v) => (
    <FormControl size='small' fullWidth disabled={submitting}>
      <InputLabel shrink id={`${id}-label`}>{labelText}</InputLabel>
      <Select
        multiple
        labelId={`${id}-label`}
        input={<OutlinedInput notched label={labelText} />}
        value={value}
        onChange={e => onChange(typeof e.target.value === 'string' ? [e.target.value] : e.target.value)}
        renderValue={selected => ((selected as string[]).length ? (selected as string[]).map(render).join(', ') : empty)}
        displayEmpty
        sx={SMALL_SELECT_SX}
      >
        {options.map(o => (
          <MenuItem key={o} value={o}>
            <Checkbox size='small' checked={value.includes(o)} />
            <ListItemText primary={render(o)} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )

  const contentLabel = (c: string) => t(`storage.clusterStorage.contentTypes.${c}` as any)

  // The connection test, under the fields it reads, above the one it fills.
  const scanRow = spec.scan && mode === 'create' ? (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <FormControl size='small' sx={{ minWidth: 160 }} disabled={scanning}>
          <InputLabel id='cs-scan-node-label'>{t('storage.clusterStorage.scanNode')}</InputLabel>
          <Select labelId='cs-scan-node-label' label={t('storage.clusterStorage.scanNode')} value={scanNode} onChange={e => setScanNode(String(e.target.value))} sx={SMALL_SELECT_SX}>
            {clusterNodes.map(n => <MenuItem key={n} value={n}>{n}</MenuItem>)}
          </Select>
        </FormControl>
        <Button
          variant='outlined'
          onClick={runScan}
          disabled={scanning || !scanNode || (spec.scan === 'iscsi' ? !fields.portal : spec.scan !== 'lvm' && !fields.server)}
          startIcon={scanning ? <CircularProgress size={14} color='inherit' /> : <Box component='i' className='ri-pulse-line' />}
        >
          {t('storage.clusterStorage.test')}
        </Button>
        {scan?.ok && (
          <Typography variant='caption' sx={{ color: 'success.main' }}>
            {t('storage.clusterStorage.scanFound', { count: scan.entries.length })}
          </Typography>
        )}
      </Box>
      {scan && !scan.ok && <Alert severity='error' sx={{ mt: 2 }}>{scan.error}</Alert>}
    </Box>
  ) : null

  const title = mode === 'create'
    ? t('storage.attachPbs.title')
    : t('storage.clusterStorage.editTitle', { storage: storage || '' })

  return (
    <Dialog open onClose={submitting ? undefined : onClose} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className={mode === 'create' ? 'ri-add-line' : 'ri-edit-line'} style={{ fontSize: 20 }} />
        {title}
      </DialogTitle>
      <DialogContent>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} /></Box>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {loadError && <Alert severity='error'>{loadError}</Alert>}

            <FormControl size='small' fullWidth disabled={mode === 'edit' || submitting}>
              <InputLabel id='cs-type-label'>{t('storage.attachPbs.storageType')}</InputLabel>
              <Select labelId='cs-type-label' label={t('storage.attachPbs.storageType')} value={type} onChange={e => pickType(String(e.target.value))} sx={SMALL_SELECT_SX}>
                {ADD_STORAGE_TYPES.filter(o => mode === 'create' || o.value === type).map(o => (
                  <MenuItem key={o.value} value={o.value}>
                    <OptionRow icon={o.icon}>{t(`storage.clusterStorage.types.${o.value}` as any)}</OptionRow>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              size='small'
              fullWidth
              required
              disabled={mode === 'edit' || submitting}
              label={t('storage.attachPbs.storageName')}
              value={storageId}
              onChange={e => setStorageId(e.target.value.trim())}
              error={idInvalid || nameTaken}
              helperText={idHelp}
            />

            {spec.fields.map(f => (
              <React.Fragment key={f.key}>
                {renderField(f)}
                {f.key === SCAN_AFTER[type] && !(type === 'lvm' && baseStorage) && scanRow}
              </React.Fragment>
            ))}

            {type === 'zfs' && <Typography variant='caption' sx={{ opacity: 0.7 }}>{t('storage.clusterStorage.zfsSshHint')}</Typography>}
            {(type === 'rbd' || type === 'cephfs') && <Typography variant='caption' sx={{ opacity: 0.7 }}>{t('storage.clusterStorage.cephNoTest')}</Typography>}


            {multiSelect('cs-content', t('storage.clusterStorage.content'), content, [...spec.contents], pickContent, '', contentLabel)}
            {multiSelect('cs-nodes', t('storage.attachPbs.nodes'), nodes, clusterNodes, setNodes, t('storage.attachPbs.allNodes'))}

            {spec.sharedChoice && (
              <FormControlLabel control={<Checkbox size='small' checked={shared} onChange={e => setShared(e.target.checked)} disabled={submitting} />} label={t('storage.clusterStorage.shared')} />
            )}
            <FormControlLabel control={<Switch size='small' checked={enabled} onChange={e => setEnabled(e.target.checked)} disabled={submitting} />} label={t('storage.clusterStorage.enabled')} />

            <Box>
              <Button size='small' onClick={() => setBwOpen(o => !o)} startIcon={<Box component='i' className={bwOpen ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />}>
                {t('storage.clusterStorage.bwlimit')}
              </Button>
              <Collapse in={bwOpen}>
                <Stack spacing={2} sx={{ mt: 1.5 }}>
                  {BWLIMIT_KINDS.map(k => (
                    <TextField
                      key={k}
                      size='small'
                      fullWidth
                      type='number'
                      disabled={submitting}
                      label={t(`storage.clusterStorage.bw.${k}` as any)}
                      placeholder={t('storage.clusterStorage.noLimit')}
                      value={bwlimit[k] ?? ''}
                      onChange={e => setBwlimit(prev => ({ ...prev, [k]: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) }))}
                      slotProps={{ htmlInput: { min: 0 } }}
                    />
                  ))}
                </Stack>
              </Collapse>
            </Box>

            {error && <Alert severity='error'>{error}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>{t('common.cancel')}</Button>
        <Button
          variant='contained'
          onClick={submit}
          disabled={!canSubmit}
          startIcon={submitting ? <CircularProgress size={16} color='inherit' /> : null}
        >
          {mode === 'create' ? t('common.create') : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
