'use client'

// LDAP diagnostics of the settings tab (roadmap#38): the explicit verdict of
// the connection test, and the read-only user lookup that names why a user
// cannot sign in (filter, ambiguity, allowed groups) and which role they get.

import { useState, type ReactNode } from 'react'

import { useTranslations } from 'next-intl'

import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, TextField, Typography } from '@mui/material'

import type {
  FilterGroupCheck,
  LdapDiagnosticEvaluation,
  LdapLookupResult,
} from '@/lib/auth/ldapDiagnostic'

export interface LdapTestCheck {
  id: string
  status: 'passed' | 'failed' | 'warning' | 'skipped' | 'not_checked'
  detail?: string
}

const CHECK_ICON: Record<LdapTestCheck['status'], { icon: string; color: string }> = {
  passed: { icon: 'ri-checkbox-circle-line', color: 'success.main' },
  failed: { icon: 'ri-close-circle-line', color: 'error.main' },
  warning: { icon: 'ri-error-warning-line', color: 'warning.main' },
  skipped: { icon: 'ri-indeterminate-circle-line', color: 'text.disabled' },
  not_checked: { icon: 'ri-question-line', color: 'text.secondary' },
}

const KNOWN_CHECKS = new Set([
  'connect', 'bind', 'base_dn', 'user_filter', 'user_lookup', 'user_password', 'group_membership', 'role_mapping',
])

/** What the connection test verified, and what it did not. */
export function LdapTestChecks({ checks }: { checks: LdapTestCheck[] }) {
  const t = useTranslations()
  if (!checks?.length) return null
  const notChecked = checks.some(c => c.status === 'not_checked')

  return (
    <Box data-testid='ldap-test-checks' sx={{ mt: 1 }}>
      <Box component='ul' sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {checks.map(c => {
          const look = CHECK_ICON[c.status] ?? CHECK_ICON.not_checked
          return (
            <Box component='li' key={c.id} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', py: 0.25 }}>
              <Box component='i' className={look.icon} sx={{ color: look.color, mt: '2px' }} />
              <Typography variant='body2' component='span'>
                <strong>{KNOWN_CHECKS.has(c.id) ? t(`ldap.checks.${c.id}`) : c.id}</strong>
                {': '}
                {t(`ldap.checks.status.${c.status}`)}
                {c.detail && (c.status === 'failed' || c.status === 'warning') ? ` (${c.detail})` : ''}
              </Typography>
            </Box>
          )
        })}
      </Box>
      {notChecked && (
        <Typography variant='body2' sx={{ mt: 1, fontWeight: 600 }}>
          {t('ldap.checks.notCheckedHint')}
        </Typography>
      )}
    </Box>
  )
}

interface DiagnosticAccount {
  exists: boolean
  email: string
  enabled?: boolean
  ldapRoleId?: string | null
}

interface DiagnosticData {
  lookup: LdapLookupResult
  evaluation: LdapDiagnosticEvaluation
  account: DiagnosticAccount | null
}

interface Props {
  /** The LDAP form state, saved or not. */
  config: Record<string, any>
  groupMappings: { group: string; role: string }[]
  roleLabel: (roleId: string) => string
  disabled?: boolean
}

const mono = { fontFamily: 'monospace', fontSize: '0.8125rem', wordBreak: 'break-all' } as const

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant='body2' fontWeight={700} sx={{ mb: 0.5 }}>{title}</Typography>
      {children}
    </Box>
  )
}

/** Read-only user lookup: why this username can or cannot sign in, and with which role. */
export function LdapUserLookupDiagnostic({ config, groupMappings, roleLabel, disabled }: Props) {
  const t = useTranslations()
  const [username, setUsername] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<DiagnosticData | null>(null)

  const run = async () => {
    setRunning(true)
    setError('')
    setData(null)
    try {
      const res = await fetch('/api/v1/auth/ldap/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          group_role_mapping: groupMappings
            .map(m => ({ group: (m.group || '').trim(), role: m.role }))
            .filter(m => m.group && m.role),
          test_username: username,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) {
        const code = json.error || ''
        if (code === 'orchestrator_outdated' || code === 'username_required') setError(t(`ldap.diag.error.${code}`))
        else setError(t('ldap.diag.error.generic', { error: json.detail || code || `HTTP ${res.status}` }))
        return
      }
      setData(json.data)
    } catch (e: any) {
      setError(t('ldap.diag.error.generic', { error: e?.message || String(e) }))
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card variant='outlined' data-testid='ldap-user-lookup'>
      <CardContent>
        <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-user-search-line' style={{ color: '#f59e0b' }} />
          {t('ldap.diag.title')}
        </Typography>
        <Typography variant='body2' sx={{ opacity: 0.7, mb: 2 }}>
          {t('ldap.diag.description')}
        </Typography>

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <TextField
            size='small'
            label={t('ldap.diag.username')}
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && username.trim() && !running) run()
            }}
            disabled={disabled}
            helperText={t('ldap.diag.usernameHelper')}
            sx={{ flex: '1 1 320px' }}
            inputProps={{ 'data-testid': 'ldap-diag-username', autoComplete: 'off' }}
          />
          <Button
            variant='outlined'
            onClick={run}
            disabled={disabled || running || !username.trim() || !config.url}
            startIcon={running ? <CircularProgress size={16} /> : <i className='ri-search-eye-line' />}
          >
            {running ? t('ldap.diag.running') : t('ldap.diag.run')}
          </Button>
        </Box>

        {error && <Alert severity='error' sx={{ mt: 2 }}>{error}</Alert>}
        {data && <DiagnosticResult data={data} groupAttribute={config.group_attribute || 'memberOf'} roleLabel={roleLabel} />}
      </CardContent>
    </Card>
  )
}

function DiagnosticResult({ data, groupAttribute, roleLabel }: { data: DiagnosticData; groupAttribute: string; roleLabel: (id: string) => string }) {
  const t = useTranslations()
  const { lookup, evaluation, account } = data
  const subject = evaluation.subject
  const blocker = evaluation.blocker

  let verdict: string
  if (blocker === null) verdict = t('ldap.diag.verdict.ok', { name: subject?.name || subject?.dn || '' })
  else if (blocker === 'invalid_filter') verdict = t('ldap.diag.verdict.invalid_filter', { error: lookup.error || '' })
  else if (blocker === 'lookup_error') {
    const stage = ['input', 'connect', 'bind', 'search'].includes(lookup.stage || '') ? t(`ldap.diag.stage.${lookup.stage}`) : (lookup.stage || '')
    verdict = t('ldap.diag.verdict.lookup_error', { stage, error: lookup.error || '' })
  } else verdict = t(`ldap.diag.verdict.${blocker}`)

  return (
    <Box data-testid='ldap-diag-result' sx={{ mt: 2 }}>
      <Alert severity={blocker === null ? 'success' : 'error'} data-testid='ldap-diag-verdict'>{verdict}</Alert>
      <Alert severity='info' icon={<i className='ri-lock-password-line' />} sx={{ mt: 1 }}>
        {t('ldap.diag.passwordNotChecked')}
      </Alert>

      {lookup.filter && (
        <Section title={t('ldap.diag.search')}>
          <Typography variant='body2'>{t('ldap.diag.filterUsed')}: <Box component='code' sx={mono}>{lookup.filter}</Box></Typography>
          {lookup.base_dn && <Typography variant='body2'>{t('ldap.diag.baseDn')}: <Box component='code' sx={mono}>{lookup.base_dn}</Box></Typography>}
          {lookup.status !== 'error' && (
            <Typography variant='body2'>
              {t('ldap.diag.matches', { count: lookup.match_count })}{lookup.more ? ` ${t('ldap.diag.moreMatches')}` : ''}
            </Typography>
          )}
          {(lookup.matches ?? []).map(dn => <Typography key={dn} variant='body2' sx={{ ...mono, pl: 2 }}>{dn}</Typography>)}
          {lookup.identity && (
            <Typography variant='body2' sx={{ mt: 0.5 }} data-testid='ldap-diag-identity'>
              {t('ldap.diag.identityFilter')}: <Box component='code' sx={mono}>{lookup.identity.filter}</Box>
              {': '}{t('ldap.diag.matches', { count: lookup.identity.match_count })}{lookup.identity.more ? ` ${t('ldap.diag.moreMatches')}` : ''}
            </Typography>
          )}
          {(lookup.identity?.matches ?? []).map(dn => <Typography key={dn} variant='body2' sx={{ ...mono, pl: 2 }}>{dn}</Typography>)}
          {subject && (
            <Typography variant='body2' sx={{ mt: 0.5 }}>
              {t('ldap.diag.foundEntry')}: <Box component='code' sx={mono}>{subject.dn}</Box>{subject.email ? ` (${subject.email})` : ''}
            </Typography>
          )}
        </Section>
      )}

      {subject && (
        <Section title={t('ldap.diag.groups', { attribute: groupAttribute })}>
          {subject.groups.length === 0
            ? <Typography variant='body2'>{t('ldap.diag.noGroups')}</Typography>
            : (
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {subject.groups.map(g => <Chip key={g} size='small' label={g} />)}
              </Box>
            )}
          {(lookup.nested_groups ?? []).length > 0 && (
            <Box sx={{ mt: 1 }} data-testid='ldap-diag-nested'>
              <Typography variant='body2'>{t('ldap.diag.nestedGroups')}</Typography>
              {lookup.nested_groups!.map(n => (
                <Typography key={n.group} variant='body2' sx={{ pl: 2 }}>
                  <Box component='code' sx={mono}>{n.group}</Box> {t('ldap.diag.nestedVia', { group: n.via })}
                </Typography>
              ))}
            </Box>
          )}
          {lookup.nested_truncated && <Typography variant='body2' sx={{ opacity: 0.7 }}>{t('ldap.diag.nestedTruncated')}</Typography>}
        </Section>
      )}

      {(lookup.filter_groups ?? []).length > 0 && (
        <Section title={t('ldap.diag.filterGroups')}>
          {lookup.filter_groups!.map(c => (
            <Typography key={c.group} variant='body2' data-testid='ldap-diag-clause'>
              <Box component='code' sx={mono}>{c.group}</Box>{': '}{clauseText(t, c)}
            </Typography>
          ))}
        </Section>
      )}

      {subject && evaluation.allowedGroup && (
        <Section title={t('ldap.diag.eligibility')}>
          <Typography variant='body2' data-testid='ldap-diag-allowed'>
            {!evaluation.allowedGroup.enforced
              ? t('ldap.diag.allowed.off')
              : evaluation.allowedGroup.allowed ? t('ldap.diag.allowed.yes') : t('ldap.diag.allowed.no')}
          </Typography>
          {evaluation.allowedGroup.nestedOnly.length > 0 && (
            <Typography variant='body2'>{t('ldap.diag.allowed.nestedOnly', { groups: evaluation.allowedGroup.nestedOnly.join(', ') })}</Typography>
          )}
        </Section>
      )}

      {subject && evaluation.role && (
        <Section title={blocker === null ? t('ldap.diag.role.title') : t('ldap.diag.role.titleIfAdmitted')}>
          <Typography variant='body2' data-testid='ldap-diag-role'>
            {evaluation.role.roleId
              ? t('ldap.diag.role.mapped', { role: roleLabel(evaluation.role.roleId), group: evaluation.role.matchedGroup || '' })
              : account?.exists
                ? t('ldap.diag.role.keepExisting')
                : t('ldap.diag.role.defaultNew', { role: roleLabel(evaluation.role.defaultRoleId) })}
          </Typography>
          {evaluation.role.nestedOnly.length > 0 && (
            <Typography variant='body2'>{t('ldap.diag.role.nestedOnly', { groups: evaluation.role.nestedOnly.join(', ') })}</Typography>
          )}
          {account && (
            <Typography variant='body2' sx={{ opacity: 0.8 }}>
              {!account.exists
                ? t('ldap.diag.account.new', { email: account.email })
                : account.enabled === false
                  ? t('ldap.diag.account.disabled', { email: account.email })
                  : t('ldap.diag.account.existing', { email: account.email })}
            </Typography>
          )}
          <Typography variant='body2' sx={{ mt: 1, opacity: 0.7 }}>{t('ldap.diag.eligibilityVsRole')}</Typography>
        </Section>
      )}

      {evaluation.hints.length > 0 && (
        <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {evaluation.hints.map(h => (
            <Alert key={h} severity='warning' data-testid={`ldap-diag-hint-${h}`}>{t(`ldap.diag.hint.${h}`)}</Alert>
          ))}
        </Box>
      )}
    </Box>
  )
}

function clauseText(t: ReturnType<typeof useTranslations>, c: FilterGroupCheck): string {
  if (c.recursive) return t('ldap.diag.clause.recursive')
  if (!c.evaluated) return t('ldap.diag.clause.unevaluated')
  if (c.direct) return t('ldap.diag.clause.direct')
  if (c.via && c.via.length > 0) return t('ldap.diag.clause.nested', { path: c.via.join(' → ') })
  return t('ldap.diag.clause.none')
}
