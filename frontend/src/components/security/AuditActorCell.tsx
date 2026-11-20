'use client'

import { Stack, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

// The actor fields of a getAuditLogs row (snake_case wire shape).
export type AuditActorRow = {
  user_email?: string | null
  api_token_id?: string | null
  api_token_name?: string | null
  api_token_prefix?: string | null
  /** The service account a token row acted as (issue #1404), while it exists. */
  service_account_name?: string | null
}

const SERVICE_ACCOUNT_DOMAIN = '@service-account.invalid'

function isServiceAccountRow(row: AuditActorRow): boolean {
  return !!row.api_token_id && !!row.user_email?.toLowerCase().endsWith(SERVICE_ACCOUNT_DOMAIN)
}

type ActorLabels = { deletedToken: string; system: string }

/**
 * Who did it, as text: a token row reads "<name> (<prefix>)" (or the deleted
 * label once the token row is gone, audit rows have no foreign key), anything
 * else keeps the email, or the system label when there is none. Shared by the
 * grid cell and the CSV export so both name the same actor.
 */
export function auditActorText(row: AuditActorRow, labels: ActorLabels): string {
  if (row.api_token_id) {
    const token = row.api_token_name ? `${row.api_token_name} (${row.api_token_prefix})` : labels.deletedToken
    return isServiceAccountRow(row) ? `${row.service_account_name || row.user_email} · ${token}` : token
  }
  return row.user_email || labels.system
}

/** DataGrid valueGetter: sort and filter on the text the cell shows. */
export function auditActorValueGetter(labels: ActorLabels) {
  return (_value: unknown, row: AuditActorRow) => auditActorText(row, labels)
}

export default function AuditActorCell({ row }: { row: AuditActorRow }) {
  const t = useTranslations()
  const text = auditActorText(row, {
    deletedToken: t('settings.apiTokens.deletedToken'),
    system: t('audit.categories.system'),
  })

  if (row.api_token_id) {
    return (
      <Stack direction='row' alignItems='center' spacing={1} sx={{ minWidth: 0 }}>
        <i className={isServiceAccountRow(row) ? 'ri-robot-2-line' : 'ri-key-2-line'} />
        <Typography variant='body2' noWrap sx={{ opacity: row.api_token_name ? 1 : 0.5 }}>{text}</Typography>
      </Stack>
    )
  }

  return (
    <Typography variant='body2' sx={{ opacity: row.user_email ? 1 : 0.5 }}>
      {text}
    </Typography>
  )
}
