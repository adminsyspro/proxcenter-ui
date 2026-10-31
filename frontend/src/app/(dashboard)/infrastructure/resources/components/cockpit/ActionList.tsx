'use client'

import { useState } from 'react'

import { Box, Button, Chip, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import PagedRows from '@/components/ui/PagedRows'

import type { ActionItem, ActionSeverity } from '../../algorithms/capacityPlanning'
import { COLORS } from '../../constants'
import { EmptyState, SectionCard } from './ui'

const SEVERITY: Record<ActionSeverity, { color: string; icon: string }> = {
  critical: { color: COLORS.error, icon: 'ri-error-warning-fill' },
  warning: { color: COLORS.warning, icon: 'ri-alert-fill' },
  info: { color: COLORS.info, icon: 'ri-information-fill' },
}

export default function ActionList({ items, onOpen }: { items: ActionItem[]; onOpen: (item: ActionItem) => void }) {
  const t = useTranslations()
  const critical = items.filter(i => i.severity === 'critical').length
  // Folded by default: the count in the header says whether it is worth opening.
  const [open, setOpen] = useState(false)

  const describe = (item: ActionItem) => {
    const params = { ...item.params }

    if (item.kind === 'runway' && typeof params.resource === 'string') {
      params.resource = t(`resources.cockpit.resource.${params.resource}`)
    }

    return t(`resources.cockpit.actions.${item.kind}`, params)
  }

  return (
    <SectionCard
      icon="ri-list-check-3"
      title={t('resources.cockpit.toHandle')}
      subtitle={t('resources.cockpit.toHandleSub')}
      open={open}
      onToggle={() => setOpen(prev => !prev)}
      action={items.length > 0 && (
        <Chip
          size="small"
          label={t('resources.cockpit.toHandleCount', { count: items.length, critical })}
          sx={{ fontWeight: 600, ...(critical > 0 && { bgcolor: alpha(COLORS.error, 0.12), color: COLORS.error }) }}
        />
      )}
    >
      {items.length === 0 ? (
        <EmptyState icon="ri-checkbox-circle-line" text={t('resources.cockpit.nothingToHandle')} />
      ) : (
        <Box sx={{ maxHeight: 340, overflowY: 'auto' }}>
          <PagedRows items={items}>
            {item => {
              const { color, icon } = SEVERITY[item.severity]

              return (
                <Stack key={item.id} direction="row" alignItems="center" spacing={1.5} sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } }}>
                  <Box sx={{ width: 24, height: 24, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(color, 0.12), color, flexShrink: 0 }}>
                    <i className={icon} style={{ fontSize: 14 }} />
                  </Box>
                  <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>{describe(item)}</Typography>
                  <Button size="small" onClick={() => onOpen(item)} endIcon={<i className="ri-arrow-right-s-line" />} sx={{ flexShrink: 0 }}>
                    {t(`resources.cockpit.tabs.${item.tab}`)}
                  </Button>
                </Stack>
              )
            }}
          </PagedRows>
        </Box>
      )}
    </SectionCard>
  )
}
