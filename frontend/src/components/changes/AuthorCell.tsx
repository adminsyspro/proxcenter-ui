'use client'

import { Box, Tooltip, Typography } from '@mui/material'
import { useLocale, useTranslations } from 'next-intl'

import TaskLogButton from '@/components/tasks/TaskLogButton'
import { ATTRIBUTION_META, actorSource, attributionOf, authorsOf, authorsOfAll, evidenceOrder } from '@/lib/changes/attribution'
import type { Attribution, ChangeActor } from '@/lib/changes/attribution'
import type { JournalChange } from '@/lib/changes/journal'
import { withKeys } from '@/lib/changes/keys'

const actorKey = (a: ChangeActor) => [a.source, a.name, a.node, a.ref].join('\u0000')

const SOURCE_ICONS: Record<ChangeActor['source'], string> = {
  audit: 'ri-shield-user-line',
  migration: 'ri-swap-box-line',
  task: 'ri-list-check-3',
  journal: 'ri-file-text-line'
}

function useActorText() {
  const t = useTranslations()

  return (a: ChangeActor) => {
    const { key, values } = actorSource(a)

    return a.token ? `${t(key, values)} · ${t('changes.actorToken')}` : t(key, values)
  }
}

/** The attribution badge: its icon in its colour, its meaning on hover. */
function AttributionIcon({ level, size = 14 }: Readonly<{ level: Attribution; size?: number }>) {
  const t = useTranslations()
  const meta = ATTRIBUTION_META[level]

  return (
    <Box
      component='i'
      className={meta.icon}
      aria-label={t(meta.label)}
      sx={{ fontSize: size, flexShrink: 0, color: meta.color === 'default' ? 'text.disabled' : `${meta.color}.main` }}
    />
  )
}

/**
 * The author column of a journal row: the accounts the changes name, after
 * the badge of the least certain attribution among them. Hovering lists the
 * evidence. A row from before attribution shows its user alone.
 */
export function AuthorCell({ changes }: Readonly<{ changes: readonly JournalChange[] }>) {
  const t = useTranslations()
  const actorText = useActorText()
  const level = attributionOf(changes)
  // A change nothing names counts as an author of its own, so a burst never
  // reads as the work of the accounts that are known alone
  const unnamed = changes.some(c => c.attribution === 'unknown' && authorsOf(c).length === 0)
  const authors = [...authorsOfAll(changes), ...(unnamed ? [t('changes.authorUnknown')] : [])]
  const text = authors.join(', ')

  if (!level) {
    return (
      <Typography variant='caption' title={text} sx={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {text}
      </Typography>
    )
  }

  const meta = ATTRIBUTION_META[level]
  const actors = evidenceOrder(changes.flatMap(c => c.actors || []))

  const title = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Typography variant='caption' sx={{ fontWeight: 700 }}>{t(meta.label)}</Typography>
      <Typography variant='caption' sx={{ opacity: 0.85 }}>{t(meta.hint)}</Typography>
      {withKeys(actors, actorKey).map(({ key, item: a }) => (
        <Typography key={key} variant='caption'>
          {a.name} · {actorText(a)}
        </Typography>
      ))}
    </Box>
  )

  return (
    <Tooltip title={title} placement='top-start'>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
        <AttributionIcon level={level} />
        <Typography
          variant='caption'
          sx={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', fontStyle: unnamed && authors.length === 1 ? 'italic' : 'normal' }}
        >
          {text}
        </Typography>
      </Box>
    </Tooltip>
  )
}

/**
 * The author section of a change's details: the attribution and each piece
 * of evidence, a Proxmox task with its log a click away.
 */
export function AuthorEvidence({ change }: Readonly<{ change: JournalChange }>) {
  const t = useTranslations()
  const locale = useLocale()
  const actorText = useActorText()
  const level = attributionOf([change])

  if (!level) return null

  const meta = ATTRIBUTION_META[level]
  const actors = evidenceOrder(change.actors || [])

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
        <AttributionIcon level={level} size={15} />
        <Typography variant='caption' sx={{ fontWeight: 700 }}>{t('changes.authorSection')} · {t(meta.label)}</Typography>
      </Box>
      {actors.length === 0 ? (
        <Typography variant='caption' sx={{ opacity: 0.6, fontStyle: 'italic' }}>{t(meta.hint)}</Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: '18px max-content minmax(0, 1fr) max-content max-content', columnGap: 1, rowGap: 0.25, alignItems: 'center' }}>
          {withKeys(actors, actorKey).map(({ key, item: a }) => (
            <Box key={key} sx={{ display: 'contents' }}>
              <i className={SOURCE_ICONS[a.source] || 'ri-user-line'} style={{ fontSize: 14, opacity: 0.6 }} />
              <Typography variant='caption' sx={{ fontWeight: 600 }}>{a.name}</Typography>
              <Typography variant='caption' sx={{ opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {actorText(a)}
              </Typography>
              <Typography variant='caption' sx={{ opacity: 0.6 }}>
                {a.at ? new Date(a.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
              </Typography>
              <Box sx={{ width: 28, display: 'flex', justifyContent: 'center' }}>
                {a.source === 'task' && a.ref && change.connectionId && (
                  <TaskLogButton connectionId={change.connectionId} upid={a.ref} node={a.node} size={14} />
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
