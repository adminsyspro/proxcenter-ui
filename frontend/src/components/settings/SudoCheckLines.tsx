'use client'

import { Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { profileState, SUDO_MIN_VERSION, SUDO_PROFILES, SUDO_PROFILE_I18N, type SudoCheck, type SudoProfile } from '@/lib/ssh/sudo'

// Two stacked MUI captions sit side by side unless each one is a block.
const CAPTION_SX = { display: 'block', ml: 3 }
const SUMMARY_SX = { display: 'block', mb: 0.5 }

/** Profiles held by no node at all: a choice of the administrator, not a fault. */
export function profilesAbsentEverywhere(checks: SudoCheck[]): SudoProfile[] {
  const ok = checks.filter(c => c.status === 'ok' || c.status === 'too-old')

  if (ok.length === 0) return []

  return SUDO_PROFILES.filter(p => ok.every(c => profileState(c.profiles[p]) === 'none'))
}

function signature(check: SudoCheck): string {
  return JSON.stringify([
    check.status,
    check.status === 'too-old' ? check.version : '',
    SUDO_PROFILES.map(p => [profileState(check.profiles[p]), check.profiles[p]?.missing.map(m => m.id) ?? []]),
    check.tooOpen?.map(r => r.id) ?? [],
  ])
}

/**
 * The check shared by every node, when the nodes tested (at least two) all
 * answered alike; the dialog then says it once instead of once per node.
 */
export function uniformSudoCheck(nodes: { status: string, sudoCheck?: SudoCheck }[]): SudoCheck | null {
  const reachable = nodes.filter(n => n.status === 'ok')

  if (reachable.length < 2 || reachable.some(n => !n.sudoCheck)) return null
  const first = signature(reachable[0].sudoCheck!)

  return reachable.every(n => signature(n.sudoCheck!) === first) ? reachable[0].sudoCheck! : null
}

interface Props {
  check: SudoCheck
  user: string
  /** Profiles no node holds: shown as not deployed, without a warning. */
  absentEverywhere?: SudoProfile[]
  /** Set when the check stands for this many nodes, said once above them. */
  summaryCount?: number
  /** False under each node when NotDeployedLine already says it once. */
  showNotDeployed?: boolean
}

/** The profiles no node holds, said once above the nodes. */
export function NotDeployedLine({ profiles }: { profiles: SudoProfile[] }) {
  const t = useTranslations()

  if (profiles.length === 0) return null

  return (
    <Typography variant='caption' color='text.secondary' sx={SUMMARY_SX}>
      {t('settings.sshSudoCheck.notDeployed', {
        features: profiles.map(p => t(`settings.sshCommands.profiles.${SUDO_PROFILE_I18N[p]}.features`)).join(' ; '),
      })}
    </Typography>
  )
}

/**
 * What the sudoers check of Test SSH found: sudo missing, no rights at all,
 * a sudo too old for the restricted template, then the profiles held, the
 * features unavailable and the rules the file lacks.
 */
export default function SudoCheckLines({ check, user, absentEverywhere = [], summaryCount, showNotDeployed = true }: Props) {
  const t = useTranslations()
  const sx = summaryCount ? SUMMARY_SX : CAPTION_SX

  if (check.status === 'missing' || check.status === 'no-rights') {
    return (
      <Typography variant='caption' color='warning.main' sx={sx}>
        {check.status === 'missing' ? t('settings.sshSudoCheck.notInstalled') : t('settings.sshSudoCheck.noRights', { user })}
      </Typography>
    )
  }

  const label = (p: SudoProfile) => t(`settings.sshCommands.profiles.${SUDO_PROFILE_I18N[p]}.label`)
  const features = (ps: SudoProfile[]) => ps.map(p => t(`settings.sshCommands.profiles.${SUDO_PROFILE_I18N[p]}.features`)).join(' ; ')

  const mark = (p: SudoProfile) => {
    const c = check.profiles[p]

    switch (profileState(c)) {
      case 'granted': return `${label(p)} ✓`
      case 'none': return `${label(p)} ✗`
      case 'partial': return `${label(p)} ${c!.checked - c!.missing.length}/${c!.checked}`
      default: return `${label(p)} ?`
    }
  }

  const absent = SUDO_PROFILES.filter(p => profileState(check.profiles[p]) === 'none')
  const absentHere = absent.filter(p => !absentEverywhere.includes(p))
  const notDeployed = absent.filter(p => absentEverywhere.includes(p))
  const partial = SUDO_PROFILES.filter(p => profileState(check.profiles[p]) === 'partial')
  const profiles = SUDO_PROFILES.map(mark).join(' · ')

  return (
    <>
      {check.status === 'too-old' && (
        <Typography variant='caption' color='warning.main' sx={sx}>
          {t('settings.sshSudoCheck.tooOld', { version: check.version ?? '', min: SUDO_MIN_VERSION.join('.') })}
        </Typography>
      )}
      <Typography variant='caption' color='text.secondary' sx={sx}>
        {summaryCount
          ? t('settings.sshSudoCheck.profilesAllNodes', { count: summaryCount, profiles })
          : t('settings.sshSudoProfiles', { profiles })}
      </Typography>
      {showNotDeployed && notDeployed.length > 0 && (
        <Typography variant='caption' color='text.secondary' sx={sx}>
          {t('settings.sshSudoCheck.notDeployed', { features: features(notDeployed) })}
        </Typography>
      )}
      {absentHere.length > 0 && (
        <Typography variant='caption' color='warning.main' sx={sx}>
          {t('settings.sshSudoMissing', { features: features(absentHere) })}
        </Typography>
      )}
      {check.tooOpen && check.tooOpen.length > 0 && (
        <Typography variant='caption' color='warning.main' sx={sx}>
          {t('settings.sshSudoCheck.tooOpen', { uses: [...new Set(check.tooOpen.map(r => r.usedBy))].join(' ; ') })}
        </Typography>
      )}
      {partial.map(p => {
        const missing = check.profiles[p]!.missing

        return (
          <Typography key={p} variant='caption' color='warning.main' sx={sx}>
            {t('settings.sshSudoCheck.incomplete', {
              profile: label(p),
              count: missing.length,
              uses: [...new Set(missing.map(m => m.usedBy))].join(' ; '),
            })}
          </Typography>
        )
      })}
    </>
  )
}
