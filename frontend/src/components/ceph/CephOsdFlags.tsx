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

import { notifyCephFlagsChanged, useCephFlagsChanged } from '@/lib/ceph/flagsEvents'
import AppDialogTitle from '@/components/ui/AppDialogTitle'
import { CephScopedFlagChips } from '@/components/ceph/CephFlagChips'
import { CEPH_GROUP_FLAGS } from '@/lib/ceph/nodeNoout'
import {
  hostFlagsForNode,
  normalizeScopedFlags,
  scopedFlagEntries,
  scopedFlagKey,
  withScopedFlag,
  type ScopedFlagMap,
} from '@/lib/ceph/osdFlagsView'

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

/**
 * Les quatre flags que `ceph osd set-group` sait poser sur un seul hôte CRUSH
 * (ui#1164), `noout` d'abord pour la même raison. Les libellés sont ceux de
 * la grille du cluster, sauf `noin` qui n'y existe pas.
 */
const HOST_GROUP_FLAG_KEYS: Record<(typeof CEPH_GROUP_FLAGS)[number], { labelKey: string; descKey: string }> = {
  noout: { labelKey: 'ceph.flagNoout', descKey: 'ceph.flagNooutDesc' },
  noin: { labelKey: 'ceph.flagNoin', descKey: 'ceph.flagNoinDesc' },
  noup: { labelKey: 'ceph.flagNoup', descKey: 'ceph.flagNoupDesc' },
  nodown: { labelKey: 'ceph.flagNodown', descKey: 'ceph.flagNodownDesc' },
}

const HOST_GROUP_FLAGS = (['noout', 'noin', 'noup', 'nodown'] as const).map(flag => ({ flag, ...HOST_GROUP_FLAG_KEYS[flag] }))

type FlagDefinition = { flag: string; labelKey: string; descKey: string }

type Props = {
  /** Connexion Proxmox qui porte le cluster Ceph. */
  connId?: string | null

  /**
   * Ne rien charger tant que le bloc n'est pas visible : les flags vivent
   * derrière un onglet, et `/cluster/ceph/flags` est un aller-retour PVE.
   */
  enabled?: boolean

  /** Interrupteurs grisés : poser un flag demande storage.admin (#920). */
  readOnly?: boolean

  /**
   * Le nœud dont on affiche l'onglet Ceph : ajoute la section des flags de
   * cet hôte seul (`ceph osd set-group`, ui#1164). Le nom est rapproché des
   * hôtes CRUSH sans tenir compte de la casse ni du domaine.
   */
  host?: string | null

  /**
   * État déjà tenu par l'appelant (le tableau des OSD du même onglet lit les
   * mêmes flags) : le panneau ne charge alors rien lui-même.
   */
  state?: CephOsdFlagsState
}

export type CephOsdFlagsState = ReturnType<typeof useCephOsdFlags>

/**
 * État des flags OSD du cluster et pose/retrait d'un flag.
 *
 * Partagé par les deux formes d'affichage (le bloc de synthèse de la page Ceph
 * et le panneau de l'onglet Ceph d'un nœud) pour qu'elles ne divergent ni sur
 * la liste des flags, ni sur leur description, ni sur l'écriture. Porte aussi
 * les flags posés sur un seul hôte ou un seul OSD (ui#1164), que la route lit
 * dans le détail de santé OSD_FLAGS.
 */
export function useCephOsdFlags(connId?: string | null, enabled = true) {
  const [flags, setFlags] = useState<string[]>([])
  const [hostFlags, setHostFlags] = useState<ScopedFlagMap>({})
  const [osdFlags, setOsdFlags] = useState<ScopedFlagMap>({})
  const [loading, setLoading] = useState(false)

  // Le flag en cours d'écriture : son nom pour le cluster, `hôte:flag` pour un hôte.
  const [toggling, setToggling] = useState<string | null>(null)

  /**
   * La lecture des flags demande NODE_VIEW et leur écriture NODE_MANAGE : un
   * compte en lecture seule sur la connexion se verrait sinon proposer huit
   * interrupteurs morts. Sur un refus, l'appelant n'affiche rien.
   */
  const [forbidden, setForbidden] = useState(false)

  // Une écriture faite ailleurs (bandeau de maintenance, autre panneau) relance
  // la lecture ; celles d'ici ne se relisent pas.
  const [reloadTick, setReloadTick] = useState(0)
  const source = useCephFlagsChanged(connId, () => setReloadTick(x => x + 1), enabled)

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

        if (!cancelled) {
          setFlags(json?.data?.flags || [])
          setHostFlags(normalizeScopedFlags(json?.data?.hostFlags))
          setOsdFlags(normalizeScopedFlags(json?.data?.osdFlags))
        }
      } catch {
        // Sans la liste, les interrupteurs restent éteints : c'est faux mais
        // inoffensif, et poser un flag les resynchronise.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [connId, enabled, reloadTick])

  /**
   * Une écriture, cluster entier ou un hôte : la route traduit en PUT value=0
   * (PVE n'a pas de DELETE sur un flag) ou en `ceph osd unset-group`. Sur un
   * échec, l'interrupteur revient à sa position d'origine au rendu suivant.
   */
  const write = useCallback(async (key: string, enable: boolean, body: { flag: string; host?: string }, apply: () => void) => {
    if (!connId) return

    setToggling(key)

    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ceph/flags`, {
        method: enable ? 'PUT' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        apply()
        notifyCephFlagsChanged(connId, source)
      }
    } catch {
      // Voir ci-dessus.
    }

    setToggling(null)
  }, [connId, source])

  const toggle = useCallback(
    (flag: string, enable: boolean) =>
      write(flag, enable, { flag }, () => setFlags(prev => (enable ? [...new Set([...prev, flag])] : prev.filter(f => f !== flag)))),
    [write],
  )

  const toggleHost = useCallback(
    (host: string, flag: string, enable: boolean) =>
      write(scopedFlagKey(host, flag), enable, { flag, host }, () => setHostFlags(prev => withScopedFlag(prev, host, flag, enable))),
    [write],
  )

  return { flags, hostFlags, osdFlags, loading, toggling, forbidden, toggle, toggleHost }
}

type SwitchesProps = {
  definitions: readonly FlagDefinition[]
  flags: string[]
  loading: boolean
  toggling: string | null

  /** La clé que `toggling` porte pour un flag de cette grille ; le flag lui-même par défaut. */
  togglingKey?: (flag: string) => string
  onToggle: (flag: string, enable: boolean) => void
  readOnly?: boolean
}

/** La grille d'interrupteurs, ON quand le flag est posé sur la cible. */
function FlagSwitches({ definitions, flags, loading, toggling, togglingKey, onToggle, readOnly = false }: SwitchesProps) {
  const t = useTranslations()

  return (
    <Grid container spacing={1}>
      {definitions.map(({ flag, labelKey, descKey }) => (
        <Grid size={{ xs: 12, sm: 6 }} key={flag}>
          <FormControlLabel
            control={
              <Switch
                checked={flags.includes(flag)}
                onChange={e => onToggle(flag, e.target.checked)}
                size='small'
                disabled={readOnly || toggling === (togglingKey ? togglingKey(flag) : flag) || loading}
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

/** Le titre d'une section quand la carte ou la modale en a deux. */
function SectionTitle({ children }: { children: string }) {
  return (
    <Typography variant='caption' fontWeight={700} sx={{ display: 'block', textTransform: 'uppercase', letterSpacing: 0.5, mb: 0.5 }}>
      {children}
    </Typography>
  )
}

/** Le liseré qui sépare la seconde section de la première. */
const SECTION_SX = { mt: 3, pt: 3, borderTop: '1px solid', borderColor: 'divider' } as const

type HostSectionProps = {
  host: string
  state: Pick<CephOsdFlagsState, 'hostFlags' | 'loading' | 'toggling' | 'toggleHost'>
  readOnly: boolean
}

/**
 * Les quatre flags de l'hôte seul. La cible de `set-group` est le bucket
 * CRUSH connu quand il existe (il peut porter le FQDN), sinon le nom du nœud.
 */
function HostFlagsSection({ host, state, readOnly }: HostSectionProps) {
  const t = useTranslations()
  const matched = hostFlagsForNode(state.hostFlags, host)
  const crushHost = matched.host ?? host

  return (
    <Box data-testid='ceph-flags-host' sx={SECTION_SX}>
      <SectionTitle>{t('ceph.flagsThisHost', { host })}</SectionTitle>
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 1.5 }}>
        {t('ceph.hostFlagsDescription')}
      </Typography>
      <FlagSwitches
        definitions={HOST_GROUP_FLAGS}
        flags={matched.flags}
        loading={state.loading}
        toggling={state.toggling}
        togglingKey={flag => scopedFlagKey(crushHost, flag)}
        onToggle={(flag, enable) => state.toggleHost(crushHost, flag, enable)}
        readOnly={readOnly}
      />
    </Box>
  )
}

/**
 * Panneau développé : la grille d'interrupteurs à même la carte. Forme utilisée
 * là où la place ne manque pas, dans l'onglet Ceph d'un nœud. Avec `host`, une
 * seconde section porte les flags de cet hôte seul.
 */
export function CephOsdFlagsPanel({ connId, enabled = true, readOnly = false, host, state }: Props) {
  const t = useTranslations()
  const own = useCephOsdFlags(state ? null : connId, enabled)
  const current = state ?? own
  const { flags, loading, toggling, forbidden, toggle } = current

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

        <Box data-testid='ceph-flags-cluster'>
          {host && <SectionTitle>{t('ceph.flagsClusterWide')}</SectionTitle>}
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 1.5 }}>
            {t('ceph.osdFlagsDescription')}
          </Typography>

          <FlagSwitches definitions={KNOWN_OSD_FLAGS} flags={flags} loading={loading} toggling={toggling} onToggle={toggle} readOnly={readOnly} />
        </Box>

        {host && <HostFlagsSection host={host} state={current} readOnly={readOnly} />}
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

  /** Les flags d'un hôte ou d'un OSD seul (ui#1164), listés sous la grille quand il y en a. */
  hostFlags?: ScopedFlagMap
  osdFlags?: ScopedFlagMap

  /** Donné, un flag d'hôte se retire depuis sa puce ; ceux d'un OSD seul restent en lecture. */
  onToggleHost?: (host: string, flag: string, enable: boolean) => void
  readOnly?: boolean
}

/**
 * Modale d'édition des flags. Chaque interrupteur écrit tout de suite sur le
 * cluster : il n'y a rien à valider, seulement à refermer.
 */
export function CephOsdFlagsDialog({
  open,
  onClose,
  flags,
  loading,
  toggling,
  onToggle,
  hostFlags = {},
  osdFlags = {},
  onToggleHost,
  readOnly = false,
}: DialogProps) {
  const t = useTranslations()
  const hasScoped = scopedFlagEntries(hostFlags, osdFlags).length > 0
  const removeHost = !readOnly && onToggleHost ? (host: string, flag: string) => onToggleHost(host, flag, false) : undefined

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <AppDialogTitle
        onClose={onClose}
        icon={<i className='ri-flag-line' style={{ fontSize: 20, opacity: 0.8 }} />}
      >
        {t('ceph.osdFlags')}
      </AppDialogTitle>
      <DialogContent dividers>
        {hasScoped && <SectionTitle>{t('ceph.flagsClusterWide')}</SectionTitle>}
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 2 }}>
          {t('ceph.osdFlagsDescription')}
        </Typography>
        <FlagSwitches definitions={KNOWN_OSD_FLAGS} flags={flags} loading={loading} toggling={toggling} onToggle={onToggle} readOnly={readOnly} />

        {hasScoped && (
          <Box data-testid='ceph-flags-per-host' sx={SECTION_SX}>
            <SectionTitle>{t('ceph.flagsPerHost')}</SectionTitle>
            <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 1.5 }}>
              {t('ceph.perHostFlagsDescription')}
            </Typography>
            <CephScopedFlagChips hostFlags={hostFlags} osdFlags={osdFlags} toggling={toggling} onRemoveHost={removeHost} />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
