'use client'
import { useEffect, useState } from 'react'
import { Box, Pagination, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'
import { kindByApiKind } from '@/lib/k8s/resourceKinds'
import type { Issue } from '@/lib/k8s/issues'
import type { K8sResourceKind, ResourceListItem } from '@/lib/k8s/types'
import { KindIcon } from './KindIcon'

const PAGE_SIZE = 8

const SEVERITY_ICON = {
  critical: { icon: 'ri-close-circle-fill', color: 'error.main' },
  warning: { icon: 'ri-error-warning-fill', color: 'warning.main' },
} as const

/** Ranked list of what is broken in the cluster; a row opens the resource. */
export function IssuesPanel({
  issues, loading, onOpen,
}: {
  issues: Issue[]
  loading: boolean
  onOpen?: (kind: K8sResourceKind, item: ResourceListItem) => void
}) {
  const t = useTranslations('kubernetes.issues')
  const tKind = useTranslations('kubernetes.explorer.kind')
  const [page, setPage] = useState(1)
  const pages = Math.max(1, Math.ceil(issues.length / PAGE_SIZE))
  useEffect(() => { if (page > pages) setPage(1) }, [page, pages])
  const critical = issues.filter(i => i.severity === 'critical').length
  const shown = issues.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 'var(--proxcenter-card-radius)', bgcolor: 'background.paper', p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: issues.length ? 1 : 0 }}>
        <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.8 }}>
          {t('title')}
        </Typography>
        {!loading && issues.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            {t('counts', { critical, warning: issues.length - critical })}
          </Typography>
        )}
      </Box>

      {!loading && issues.length === 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <Box component="i" className="ri-checkbox-circle-fill" sx={{ color: 'success.main', fontSize: 18 }} />
          <Typography variant="body2" color="text.secondary">{t('empty')}</Typography>
        </Box>
      )}
      {loading && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{t('loading')}</Typography>}

      {shown.map(issue => {
        const sev = SEVERITY_ICON[issue.severity]
        const kd = kindByApiKind(issue.kind)
        return (
          <Box
            key={`${issue.kind}/${issue.item.namespace ?? ''}/${issue.item.name}/${issue.reason}`}
            role="button"
            tabIndex={0}
            onClick={() => onOpen?.(issue.kind, issue.item)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(issue.kind, issue.item) } }}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1, py: 0.6, px: 0.75, borderRadius: 1, cursor: 'pointer', minWidth: 0,
              '&:hover, &:focus-visible': { bgcolor: 'action.hover', outline: 'none' },
            }}
          >
            <Box component="i" className={sev.icon} sx={{ color: sev.color, fontSize: 16, flexShrink: 0 }} aria-label={t(`severity.${issue.severity}`)} />
            <Box title={tKind(issue.kind)} sx={{ display: 'flex', flexShrink: 0, color: 'text.secondary' }}>
              <KindIcon icon={kd?.icon ?? 'ri-circle-line'} iconImg={kd?.iconImg} size={15} />
            </Box>
            <Typography noWrap sx={{ fontWeight: 600, fontSize: '0.875rem', flexShrink: 1, minWidth: 0, maxWidth: '40%' }} title={issue.item.name}>
              {issue.item.name}
            </Typography>
            {issue.item.namespace && (
              <Typography noWrap variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{issue.item.namespace}</Typography>
            )}
            <Typography noWrap variant="body2" sx={{ flex: 1, minWidth: 0, color: 'text.secondary' }}>
              {t(`reason.${issue.reason}`, { detail: issue.detail ?? '' })}
            </Typography>
            <Box component="i" className="ri-arrow-right-s-line" sx={{ color: 'text.secondary', fontSize: 16, flexShrink: 0 }} />
          </Box>
        )
      })}

      {pages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
          <Pagination size="small" count={pages} page={page} onChange={(_, p) => setPage(p)} />
        </Box>
      )}
    </Box>
  )
}
