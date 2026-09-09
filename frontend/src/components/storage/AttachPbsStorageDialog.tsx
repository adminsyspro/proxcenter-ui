'use client'

import React, { useEffect, useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'

/**
 * Storage types this dialog can attach. Only `pbs` today; the select exists so
 * adding NFS, CIFS or the rest is a matter of adding an entry and its fields,
 * not of moving the entry point (issue #890).
 */
const STORAGE_TYPES = [
  { value: 'pbs', labelKey: 'storage.attachPbs.typePbs', icon: 'ri-hard-drive-2-fill' },
] as const

/** Glyphe d'un datastore, celui de l'arbre d'inventaire. */
const DATASTORE_ICON = 'ri-database-2-line'

/** Une entrée de liste: le glyphe puis le libellé, alignés. */
function OptionRow({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Box component='i' className={icon} sx={{ fontSize: 16, opacity: 0.8, flexShrink: 0 }} />
      {children}
    </Box>
  )
}

type PbsConnection = { id: string; name: string; baseUrl?: string | null; fingerprint?: string | null }

type Datastore = { name: string; comment?: string }

type AttachPbsStorageDialogProps = {
  open: boolean
  onClose: () => void
  /**
   * The cluster the storage is attached to. No selector: the dialog is opened
   * from that cluster's Storage tab, which is the context already.
   */
  cluster: { id: string; name?: string | null }
  onAttached: () => void
}

/** PVE storage ids start with a letter, so a datastore named `2024` cannot pass through as-is. */
function suggestStorageName(datastore: string): string {
  const core = datastore.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

  return core ? `pbs-${core}`.slice(0, 40) : ''
}

export default function AttachPbsStorageDialog({
  open,
  onClose,
  cluster,
  onAttached,
}: AttachPbsStorageDialogProps) {
  const t = useTranslations()

  const clusterId = cluster.id

  const [storageType, setStorageType] = useState<string>(STORAGE_TYPES[0].value)
  const [source, setSource] = useState('')
  const [datastore, setDatastore] = useState('')
  const [namespace, setNamespace] = useState('')
  const [typedStorage, setTypedStorage] = useState<string | null>(null)
  const [nodes, setNodes] = useState<string[]>([])

  const [pbsConnections, setPbsConnections] = useState<PbsConnection[]>([])
  const [datastores, setDatastores] = useState<Datastore[]>([])
  /** Backup server whose datastore listing has landed, so loading is derived. */
  const [loadedSource, setLoadedSource] = useState<string | null>(null)
  const [clusterNodes, setClusterNodes] = useState<string[]>([])
  const [attached, setAttached] = useState<Array<{ storage: string; type: string; server: string | null; datastore: string | null }>>([])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedPbs = pbsConnections.find(c => c.id === source) || null

  // The parent mounts this dialog only while it is open, so every field starts
  // empty on each open: a dialog reopened after a failure must never keep the
  // previous secret in a field the operator cannot see.
  useEffect(() => {
    fetch('/api/v1/connections?type=pbs')
      .then(r => r.json())
      .then(json => setPbsConnections(Array.isArray(json?.data) ? json.data : []))
      .catch(() => setPbsConnections([]))
  }, [])

  // Nodes and existing PBS storages of the target cluster: both are needed to
  // tell the operator what is already attached before they attach a duplicate.
  // The `alive` guard drops a late answer from the cluster picked before this
  // one, which would otherwise overwrite the current lists.
  useEffect(() => {
    if (!clusterId) return

    let alive = true

    fetch(`/api/v1/connections/${encodeURIComponent(clusterId)}/nodes`)
      .then(r => r.json())
      .then(json => {
        if (alive) setClusterNodes((Array.isArray(json?.data) ? json.data : []).map((n: any) => String(n?.node)).filter(Boolean))
      })
      .catch(() => { if (alive) setClusterNodes([]) })

    fetch(`/api/v1/connections/${encodeURIComponent(clusterId)}/storage`)
      .then(r => r.json())
      .then(json => {
        if (!alive) return

        // Toutes les lignes, pas seulement les PBS: un nom déjà porté par un
        // `local` ou un pool Ceph est pris lui aussi, et le refuser ici vaut
        // mieux que de laisser PVE répondre 409 après la soumission.
        setAttached(
          (Array.isArray(json?.data) ? json.data : []).map((s: any) => ({
            storage: s.storage,
            type: s.type,
            server: s.server ?? null,
            datastore: s.datastore ?? null,
          })),
        )
      })
      .catch(() => { if (alive) setAttached([]) })

    return () => { alive = false }
  }, [clusterId])

  // Datastores of the selected backup server.
  useEffect(() => {
    if (!source) return

    let alive = true

    fetch(`/api/v1/pbs/${encodeURIComponent(source)}/datastores`)
      .then(r => r.json())
      .then(json => {
        if (!alive) return

        setDatastores(Array.isArray(json?.data) ? json.data : [])
        setLoadedSource(source)
      })
      .catch(() => {
        if (!alive) return

        setDatastores([])
        setLoadedSource(source)
      })

    return () => { alive = false }
  }, [source])

  const datastoresLoading = !!source && loadedSource !== source

  // The storage id follows the datastore until the operator types their own.
  const storage = typedStorage ?? suggestStorageName(datastore)

  /** The same datastore on the same server, already mounted on this cluster. */
  const duplicate = useMemo(() => {
    if (!datastore || !selectedPbs) return null

    // Two backup servers can hold a datastore of the same name, so the host
    // has to match too. It is compared on the bare host, which is what PVE
    // stores in `server`.
    const host = String(selectedPbs.baseUrl ?? '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '')

    return attached.find(a => (
      a.type === 'pbs' && a.datastore === datastore && (!host || !a.server || a.server === host)
    )) ?? null
  }, [attached, datastore, selectedPbs])

  const nameTaken = attached.some(a => a.storage === storage)

  const missingFingerprint = !!selectedPbs && !selectedPbs.fingerprint

  const canSubmit =
    storageType === 'pbs' &&
    !!clusterId &&
    !!source &&
    !!datastore &&
    !!storage &&
    !nameTaken &&
    !missingFingerprint &&
    !submitting

  const submit = async () => {
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(clusterId)}/storage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'pbs',
          storage,
          datastore,
          namespace,
          nodes,
          pbsConnectionId: source,
        }),
      })

      const json = await res.json()

      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)

      onAttached()
      onClose()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth='sm' fullWidth>
      <DialogTitle>{t('storage.attachPbs.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          <FormControl size='small' fullWidth>
            <InputLabel id='attach-pbs-type-label'>{t('storage.attachPbs.storageType')}</InputLabel>
            <Select
              labelId='attach-pbs-type-label'
              id='attach-pbs-type'
              label={t('storage.attachPbs.storageType')}
              value={storageType}
              onChange={e => setStorageType(String(e.target.value))}
            >
              {STORAGE_TYPES.map(type => (
                <MenuItem key={type.value} value={type.value}>
                  <OptionRow icon={type.icon}>{t(type.labelKey as any)}</OptionRow>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Typography variant='body2' sx={{ opacity: 0.7 }}>
            {t('storage.attachPbs.subtitle')}
          </Typography>

          {/* Seul un PBS déjà déclaré dans les connexions est rattachable, d'où
              l'absence de saisie manuelle: la règle est dite dans l'infobulle. */}
          <Tooltip title={t('storage.attachPbs.sourceHint')} placement='top-start'>
            <FormControl size='small' fullWidth>
              <InputLabel id='attach-pbs-source-label'>{t('storage.attachPbs.source')}</InputLabel>
              <Select
                labelId='attach-pbs-source-label'
                id='attach-pbs-source'
                label={t('storage.attachPbs.source')}
                value={source}
                onChange={e => {
                  setSource(String(e.target.value))
                  setDatastore('')
                  setDatastores([])
                }}
              >
                {pbsConnections.map(c => (
                  <MenuItem key={c.id} value={c.id}>
                    <OptionRow icon={STORAGE_TYPES[0].icon}>{c.name}</OptionRow>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Tooltip>

          {pbsConnections.length === 0 && (
            <Alert severity='info'>{t('storage.attachPbs.noPbsConnection')}</Alert>
          )}

          {missingFingerprint && (
            <Alert severity='warning'>{t('storage.attachPbs.missingFingerprint')}</Alert>
          )}

          <FormControl size='small' fullWidth disabled={!source || datastoresLoading}>
            <InputLabel id='attach-pbs-datastore-label'>{t('storage.attachPbs.datastore')}</InputLabel>
            <Select
              labelId='attach-pbs-datastore-label'
              id='attach-pbs-datastore'
              label={t('storage.attachPbs.datastore')}
              value={datastore}
              onChange={e => setDatastore(String(e.target.value))}
              endAdornment={datastoresLoading ? <CircularProgress size={16} sx={{ mr: 3 }} /> : null}
            >
              {datastores.map(d => (
                <MenuItem key={d.name} value={d.name}>
                  <OptionRow icon={DATASTORE_ICON}>
                    <ListItemText primary={d.name} secondary={d.comment || null} sx={{ my: 0 }} />
                  </OptionRow>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {duplicate && (
            <Alert severity='warning'>
              {t('storage.attachPbs.alreadyAttached', { storage: duplicate.storage })}
            </Alert>
          )}

          <TextField
            size='small'
            fullWidth
            label={t('storage.attachPbs.namespace')}
            value={namespace}
            onChange={e => setNamespace(e.target.value)}
            helperText={t('storage.attachPbs.namespaceHelp')}
          />

          <TextField
            size='small'
            fullWidth
            label={t('storage.attachPbs.storageName')}
            value={storage}
            onChange={e => setTypedStorage(e.target.value)}
            error={nameTaken}
            helperText={nameTaken ? t('storage.attachPbs.nameTaken') : t('storage.attachPbs.storageNameHelp')}
          />

          {/* `displayEmpty` fait rendre « Tous les nœuds » alors qu'aucune valeur
              n'est choisie, et sans `shrink` + encoche explicite le libellé
              flottant se superpose à ce texte (piège MUI mesuré ici). */}
          <FormControl size='small' fullWidth>
            <InputLabel shrink id='attach-pbs-nodes-label'>{t('storage.attachPbs.nodes')}</InputLabel>
            <Select
              multiple
              labelId='attach-pbs-nodes-label'
              id='attach-pbs-nodes'
              input={<OutlinedInput notched label={t('storage.attachPbs.nodes')} />}
              value={nodes}
              onChange={e => setNodes(typeof e.target.value === 'string' ? [e.target.value] : e.target.value)}
              renderValue={selected => (selected as string[]).length ? (selected as string[]).join(', ') : t('storage.attachPbs.allNodes')}
              displayEmpty
            >
              {clusterNodes.map(n => (
                <MenuItem key={n} value={n}>
                  <Checkbox size='small' checked={nodes.includes(n)} />
                  <ListItemText primary={n} />
                </MenuItem>
              ))}
            </Select>
            <Typography variant='caption' sx={{ mt: 0.5, opacity: 0.6 }}>
              {t('storage.attachPbs.nodesHelp')}
            </Typography>
          </FormControl>

          {!!source && (
            <Alert severity='info'>{t('storage.attachPbs.scopedToken')}</Alert>
          )}

          {error && <Alert severity='error'>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>{t('common.cancel')}</Button>
        <Button
          variant='contained'
          onClick={submit}
          disabled={!canSubmit}
          startIcon={submitting ? <CircularProgress size={16} color='inherit' /> : <Box component='i' className='ri-link' />}
        >
          {t('storage.attachPbs.submit')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
