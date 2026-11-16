'use client'

import React, { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material'

import { useBranding } from '@/contexts/BrandingContext'
import { useRBAC } from '@/contexts/RBACContext'
import NodeUpdateDialog from '@/components/NodeUpdateDialog'

import type { DetailsPayload } from '../types'
import { SUBSCRIPTION_LEVEL_LABEL, hostSubscriptionState } from './hostSubscription'

type HostUpdate = { package?: string; currentVersion?: string; newVersion?: string; description?: string }

/** One label / value line of a dialog, the value aligned on the right. */
function InfoLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' } }}>
      <Typography variant="body2" sx={{ color: 'text.secondary', flexShrink: 0 }}>{label}</Typography>
      <Box sx={{ minWidth: 0, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</Box>
    </Box>
  )
}

/**
 * Pending updates and subscription state of a node, as two badges of the node
 * header. Each badge opens its own dialog; both are for an admin only.
 */
export default function NodeHostBadges({
  hostInfo,
  connId,
  nodeName,
  vmCount,
  isCluster,
  hasCeph,
  onRefreshSubscription,
}: {
  hostInfo?: DetailsPayload['hostInfo']
  connId: string
  nodeName: string
  vmCount?: number
  isCluster?: boolean
  hasCeph?: boolean
  onRefreshSubscription?: () => void | Promise<void>
}) {
  const t = useTranslations()
  const { isAdmin } = useRBAC()
  const { branding } = useBranding()

  const [updatesOpen, setUpdatesOpen] = useState(false)
  const [subscriptionOpen, setSubscriptionOpen] = useState(false)
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [checkingSubscription, setCheckingSubscription] = useState(false)

  const updates = (isAdmin ? hostInfo?.updates || [] : []) as HostUpdate[]
  const subscription = isAdmin && (!branding.enabled || branding.showSubscription !== false) ? hostInfo?.subscription : undefined
  const subState = subscription ? hostSubscriptionState(subscription) : null

  if (updates.length === 0 && !subState) return null

  const subLabel = subState ? t(`subscription.${SUBSCRIPTION_LEVEL_LABEL[subState.level]}`) : ''

  const checkSubscription = async () => {
    setCheckingSubscription(true)
    try {
      await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(nodeName)}/subscription`, { method: 'POST' })
      await onRefreshSubscription?.()
    } catch (err) {
      console.error('Failed to check subscription:', err)
    } finally {
      setCheckingSubscription(false)
    }
  }

  return (
    <>
      {updates.length > 0 && (
        <Chip
          size="small"
          variant="outlined"
          icon={<i className="ri-download-cloud-line" style={{ fontSize: 14, color: '#ff9800' }} />}
          label={t('updates.updatesCount', { count: updates.length })}
          onClick={() => setUpdatesOpen(true)}
          sx={{ fontWeight: 500, flexShrink: 0 }}
        />
      )}
      {subState && (
        <Chip
          size="small"
          variant="outlined"
          icon={<i className="ri-vip-crown-line" style={{ fontSize: 14, color: subState.color }} />}
          label={subLabel}
          onClick={() => setSubscriptionOpen(true)}
          sx={{ fontWeight: 500, flexShrink: 0 }}
        />
      )}

      {/* Available updates */}
      <Dialog open={updatesOpen} onClose={() => setUpdatesOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-download-cloud-line" style={{ fontSize: 22, color: '#ff9800' }} />
          {t('updates.availableUpdates')}
          <Chip size="small" color="warning" label={updates.length} sx={{ height: 20, fontWeight: 500 }} />
          <Typography variant="body2" sx={{ ml: 'auto', color: 'text.secondary' }}>{nodeName}</Typography>
        </DialogTitle>
        <DialogContent dividers sx={{ py: 0.5 }}>
          {updates.map((u, idx) => (
            <InfoLine key={`${u.package}-${idx}`} label={u.package || ''}>
              <Typography variant="body2" component="span" sx={{ color: 'text.secondary' }}>{u.currentVersion}</Typography>
              <i className="ri-arrow-right-line" style={{ fontSize: 12, opacity: 0.5, margin: '0 6px' }} />
              <Typography variant="body2" component="span" sx={{ color: 'success.main', fontWeight: 500 }}>{u.newVersion}</Typography>
            </InfoLine>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUpdatesOpen(false)}>{t('common.close')}</Button>
          <Button variant="outlined" color="warning" startIcon={<i className="ri-file-list-line" />} onClick={() => setChangelogOpen(true)}>
            Changelog
          </Button>
          <Button
            variant="contained"
            color="warning"
            startIcon={<i className="ri-download-line" />}
            onClick={() => { setUpdatesOpen(false); setUpgradeOpen(true) }}
          >
            {t('updates.upgrade')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Subscription */}
      {subscription && subState && (
        <Dialog open={subscriptionOpen} onClose={() => setSubscriptionOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-vip-crown-line" style={{ fontSize: 22, color: subState.color }} />
            {t('inventory.tabSubscription')}
            <Chip size="small" color={subState.chipColor} label={subLabel} sx={{ height: 20, fontWeight: 500 }} />
          </DialogTitle>
          <DialogContent dividers sx={{ py: 0.5 }}>
            <InfoLine label={t('subscription.type')}><Typography variant="body2" sx={{ fontWeight: 500 }}>{subscription.type || '—'}</Typography></InfoLine>
            <InfoLine label={t('subscription.key')}><Typography variant="body2">{subscription.key || '—'}</Typography></InfoLine>
            <InfoLine label={t('subscription.serverId')}><Typography variant="body2" title={subscription.serverId}>{subscription.serverId || '—'}</Typography></InfoLine>
            <InfoLine label={t('subscription.sockets')}><Typography variant="body2">{subscription.sockets ?? '—'}</Typography></InfoLine>
            <InfoLine label={t('subscription.lastChecked')}><Typography variant="body2">{subscription.lastChecked || '—'}</Typography></InfoLine>
            <InfoLine label={t('subscription.nextDueDate')}>
              <Typography variant="body2" sx={{ fontWeight: 500, color: subState.color }}>
                {subscription.nextDueDate || '—'}
                {subState.isExpiringSoon && subState.daysUntilDue !== null && ` (${subState.daysUntilDue}j)`}
              </Typography>
            </InfoLine>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSubscriptionOpen(false)}>{t('common.close')}</Button>
            <Button
              variant="outlined"
              startIcon={checkingSubscription ? <CircularProgress size={14} /> : <i className="ri-refresh-line" />}
              onClick={() => { void checkSubscription() }}
              disabled={checkingSubscription}
            >
              {t('subscription.check')}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      <NodeUpdateDialog
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        connectionId={connId}
        nodeName={nodeName}
        vmCount={vmCount || 0}
        nodeUpdates={{
          [nodeName]: {
            count: updates.length,
            updates: updates.map(u => ({ Package: u.package, OldVersion: u.currentVersion, Version: u.newVersion })),
            version: hostInfo?.pveVersion || null,
          },
        }}
        isCluster={isCluster}
        hasCeph={hasCeph}
      />

      {/* Changelog, over the updates dialog */}
      <Dialog open={changelogOpen} onClose={() => setChangelogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-file-list-line" style={{ fontSize: 24, color: '#ff9800' }} />{' '}
          Changelog
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          <Box sx={{ maxHeight: 500, overflow: 'auto' }}>
            {updates.map((update, idx) => (
              <Accordion
                key={idx}
                disableGutters
                elevation={0}
                square
                sx={{
                  '&:before': { display: 'none' },
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  '&:last-child': { borderBottom: 'none' },
                }}
              >
                <AccordionSummary
                  expandIcon={<i className="ri-subtract-line" style={{ fontSize: 14, opacity: 0.5 }} />}
                  sx={{ minHeight: 44, '& .MuiAccordionSummary-content': { my: 0 } }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                    <Typography variant="body2" fontWeight={500} sx={{ flex: 1 }}>
                      {update.package}
                    </Typography>
                    <Chip
                      size="small"
                      label={`${update.currentVersion || 'null'} → ${update.newVersion}`}
                      sx={{ height: 20, fontSize: 10, fontFamily: 'monospace' }}
                    />
                  </Box>
                </AccordionSummary>
                <AccordionDetails sx={{ bgcolor: 'action.hover', py: 1.5 }}>
                  <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', opacity: 0.8 }}>
                    {update.description || t('updates.noChangelogAvailable')}
                  </Typography>
                </AccordionDetails>
              </Accordion>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setChangelogOpen(false)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
