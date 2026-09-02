'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  Grid,
  Switch,
  Typography,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'

/**
 * Les flags OSD que PVE sait poser, dans l'ordre où la maintenance les utilise.
 * `noout` d'abord : c'est celui qu'on pose avant d'éteindre un nœud, pour que
 * Ceph ne reconstruise pas pour rien les données de ses OSD.
 */
const KNOWN_OSD_FLAGS = [
  { flag: 'noout', labelKey: 'ceph.flagNoout', descKey: 'ceph.flagNooutDesc' },
  { flag: 'norebalance', labelKey: 'ceph.flagNorebalance', descKey: 'ceph.flagNorebalanceDesc' },
  { flag: 'norecover', labelKey: 'ceph.flagNorecover', descKey: 'ceph.flagNorecoverDesc' },
  { flag: 'noscrub', labelKey: 'ceph.flagNoscrub', descKey: 'ceph.flagNoscrubDesc' },
  { flag: 'nodeep-scrub', labelKey: 'ceph.flagNodeepScrub', descKey: 'ceph.flagNodeepScrubDesc' },
  { flag: 'nobackfill', labelKey: 'ceph.flagNobackfill', descKey: 'ceph.flagNobackfillDesc' },
  { flag: 'noup', labelKey: 'ceph.flagNoup', descKey: 'ceph.flagNoupDesc' },
  { flag: 'nodown', labelKey: 'ceph.flagNodown', descKey: 'ceph.flagNodownDesc' },
] as const

type Props = {
  /** Connexion Proxmox qui porte le cluster Ceph. */
  connId?: string | null

  /**
   * Ne rien charger tant que le bloc n'est pas visible : les flags vivent
   * derrière un onglet, et `/cluster/ceph/flags` est un aller-retour PVE.
   */
  enabled?: boolean
}

/**
 * État des flags OSD du cluster et pose/retrait d'un flag.
 *
 * Partagé par les deux formes d'affichage (le bloc de synthèse de la page Ceph
 * et le panneau de l'onglet Ceph d'un nœud) pour qu'elles ne divergent ni sur
 * la liste des flags, ni sur leur description, ni sur l'écriture.
 */
export function useCephOsdFlags(connId?: string | null, enabled = true) {
  const [flags, setFlags] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)

  /**
   * La lecture des flags demande NODE_VIEW et leur écriture NODE_MANAGE : un
   * compte en lecture seule sur la connexion se verrait sinon proposer huit
   * interrupteurs morts. Sur un refus, l'appelant n'affiche rien.
   */
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    if (!enabled || !connId) return

    let cancelled = false

    // Le setState de chargement vit dans cette fonction et non dans le corps de
    // l'effet, sinon react-hooks/set-state-in-effect le signale.
    const load = async () => {
      setLoading(true)

      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ceph/flags`)

        if (res.status === 401 || res.status === 403) {
          if (!cancelled) setForbidden(true)

          return
        }

        const json = await res.json()

        if (!cancelled) setFlags(json?.data?.flags || [])
      } catch {
        // Sans la liste, les interrupteurs restent éteints : c'est faux mais
        // inoffensif, et poser un flag les resynchronise.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [connId, enabled])

  const toggle = useCallback(async (flag: string, enable: boolean) => {
    if (!connId) return

    setToggling(flag)

    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ceph/flags`, {
        method: enable ? 'PUT' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flag }),
      })

      // PVE n'a pas de DELETE sur un flag : la route traduit en PUT value=0.
      if (res.ok) {
        setFlags(prev => (enable ? [...new Set([...prev, flag])] : prev.filter(f => f !== flag)))
      }
    } catch {
      // L'interrupteur revient à sa position d'origine au rendu suivant.
    }

    setToggling(null)
  }, [connId])

  return { flags, loading, toggling, forbidden, toggle }
}

type SwitchesProps = {
  flags: string[]
  loading: boolean
  toggling: string | null
  onToggle: (flag: string, enable: boolean) => void
}

/** La grille d'interrupteurs, ON quand le flag est posé sur le cluster. */
function FlagSwitches({ flags, loading, toggling, onToggle }: SwitchesProps) {
  const t = useTranslations()

  return (
    <Grid container spacing={1}>
      {KNOWN_OSD_FLAGS.map(({ flag, labelKey, descKey }) => (
        <Grid size={{ xs: 12, sm: 6 }} key={flag}>
          <FormControlLabel
            control={
              <Switch
                checked={flags.includes(flag)}
                onChange={e => onToggle(flag, e.target.checked)}
                size='small'
                disabled={toggling === flag || loading}
              />
            }
            label={
              <Box>
                <Typography variant='body2' sx={{ fontWeight: 600, fontSize: 12 }}>
                  {t(labelKey as any)}
                </Typography>
                <Typography variant='caption' color='text.secondary'>
                  {t(descKey as any)}
                </Typography>
              </Box>
            }
            sx={{ alignItems: 'flex-start', ml: 0, '& .MuiSwitch-root': { mt: 0.5 } }}
          />
        </Grid>
      ))}
    </Grid>
  )
}

/**
 * Panneau développé : la grille d'interrupteurs à même la carte. Forme utilisée
 * là où la place ne manque pas, dans l'onglet Ceph d'un nœud.
 */
export function CephOsdFlagsPanel({ connId, enabled = true }: Props) {
  const t = useTranslations()
  const { flags, loading, toggling, forbidden, toggle } = useCephOsdFlags(connId, enabled)

  if (forbidden) return null

  return (
    <Card variant='outlined'>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-flag-line' style={{ fontSize: 18 }} />
            <Typography variant='subtitle2' fontWeight={700}>{t('ceph.osdFlags')}</Typography>
          </Box>
          {loading && <CircularProgress size={16} />}
        </Box>

        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 1.5 }}>
          {t('ceph.osdFlagsDescription')}
        </Typography>

        <FlagSwitches flags={flags} loading={loading} toggling={toggling} onToggle={toggle} />
      </CardContent>
    </Card>
  )
}

type DialogProps = {
  open: boolean
  onClose: () => void
  flags: string[]
  loading: boolean
  toggling: string | null
  onToggle: (flag: string, enable: boolean) => void
}

/**
 * Modale d'édition des flags. Chaque interrupteur écrit tout de suite sur le
 * cluster : il n'y a rien à valider, seulement à refermer.
 */
export function CephOsdFlagsDialog({ open, onClose, flags, loading, toggling, onToggle }: DialogProps) {
  const t = useTranslations()

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <AppDialogTitle
        onClose={onClose}
        icon={<i className='ri-flag-line' style={{ fontSize: 20, opacity: 0.8 }} />}
      >
        {t('ceph.osdFlags')}
      </AppDialogTitle>
      <DialogContent dividers>
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 2 }}>
          {t('ceph.osdFlagsDescription')}
        </Typography>
        <FlagSwitches flags={flags} loading={loading} toggling={toggling} onToggle={onToggle} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
