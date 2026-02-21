'use client'

import {
  Box,
  Chip,
  Divider,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import type { SelectedMapItem } from './types'
import { getVmProtectionColor, getVmStatusColor, getFlowStatusColor } from './lib/securityMapColors'

interface SecurityMapSidebarProps {
  selected: SelectedMapItem
  onClose: () => void
}

export default function SecurityMapSidebar({ selected, onClose }: SecurityMapSidebarProps) {
  const theme = useTheme()
  const t = useTranslations('networkPage')

  return (
    <Box
      sx={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: 320,
        height: '100%',
        bgcolor: 'background.paper',
        borderLeft: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
        zIndex: 10,
        overflow: 'auto',
        boxShadow: '-4px 0 12px rgba(0,0,0,0.1)',
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1.5, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
        <Typography variant='subtitle2' fontWeight={700} sx={{ flex: 1 }}>
          {t('securityMap.details')}
        </Typography>
        <IconButton size='small' onClick={onClose}>
          <i className='ri-close-line' style={{ fontSize: 18 }} />
        </IconButton>
      </Box>

      <Box sx={{ p: 2 }}>
        {selected.type === 'zone' && <ZoneDetails data={selected.data} t={t} />}
        {selected.type === 'vm' && <VmDetails data={selected.data} t={t} />}
        {selected.type === 'edge' && <EdgeDetails data={selected.data} t={t} />}
        {selected.type === 'internet' && <InternetDetails t={t} />}
        {selected.type === 'clusterFirewall' && <ClusterFwDetails data={selected.data} t={t} />}
      </Box>
    </Box>
  )
}

// ── Zone Details ──

function ZoneDetails({ data, t }: { data: any; t: any }) {
  const isolatedCount = data.vms.filter((v: any) => v.isIsolated).length
  const unprotectedCount = data.vms.filter((v: any) => !v.firewallEnabled).length

  return (
    <>
      <Typography variant='subtitle2' fontWeight={700} gutterBottom>
        {t('securityMap.zoneDetails')}
      </Typography>

      <DetailRow label={t('securityMap.cidr')} value={data.cidr} mono />
      <DetailRow
        label={t('securityMap.gateway')}
        value={data.hasGateway ? `${data.gateway}` : '-'}
        chip={data.hasGateway ? 'success' : 'default'}
      />
      <DetailRow
        label={t('securityMap.baseSg')}
        value={data.hasBaseSg ? 'Active' : '-'}
        chip={data.hasBaseSg ? 'success' : 'default'}
      />

      <Divider sx={{ my: 1.5 }} />

      <Typography variant='caption' fontWeight={600} gutterBottom>
        {t('securityMap.vmsInZone')} ({data.vms.length})
      </Typography>

      <Box sx={{ mt: 0.5 }}>
        <DetailRow label={t('securityMap.isolatedVms')} value={`${isolatedCount}`} />
        <DetailRow label={t('securityMap.unprotectedVms')} value={`${unprotectedCount}`} />
      </Box>

      <Divider sx={{ my: 1.5 }} />

      {data.vms.map((vm: any) => {
        const protColor = getVmProtectionColor(vm.isIsolated, vm.firewallEnabled)
        const statusColor = getVmStatusColor(vm.status)

        return (
          <Box key={`${vm.node}-${vm.vmid}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.5 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: statusColor, flexShrink: 0 }} />
            <Typography variant='caption' noWrap sx={{ flex: 1, fontSize: '0.7rem' }}>
              {vm.name}
            </Typography>
            <i className='ri-shield-line' style={{ fontSize: 12, color: protColor }} />
          </Box>
        )
      })}
    </>
  )
}

// ── VM Details ──

function VmDetails({ data, t }: { data: any; t: any }) {
  return (
    <>
      <Typography variant='subtitle2' fontWeight={700} gutterBottom>
        {t('securityMap.vmDetails')} — {data.name}
      </Typography>

      <DetailRow label="VMID" value={`${data.vmid}`} />
      <DetailRow label="Node" value={data.node} />
      <DetailRow
        label={t('securityMap.firewallStatus')}
        value={data.firewallEnabled ? t('securityMap.enabled') : t('securityMap.disabled')}
        chip={data.firewallEnabled ? 'success' : 'error'}
      />

      <Divider sx={{ my: 1.5 }} />

      <Typography variant='caption' fontWeight={600} gutterBottom>
        {t('securityMap.appliedSgs')}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
        {data.appliedSgs.length > 0
          ? data.appliedSgs.map((sg: string) => (
            <Chip key={sg} label={sg} size='small' variant='outlined' sx={{ fontSize: '0.65rem' }} />
          ))
          : <Typography variant='caption' color='text.secondary'>-</Typography>
        }
      </Box>

      {(!data.firewallEnabled || !data.isIsolated) && (
        <>
          <Divider sx={{ my: 1.5 }} />
          <Typography variant='caption' fontWeight={600} gutterBottom>
            {t('securityMap.recommendations')}
          </Typography>
          <Box sx={{ mt: 0.5 }}>
            {!data.firewallEnabled && (
              <Typography variant='caption' color='warning.main' sx={{ display: 'block', fontSize: '0.65rem' }}>
                • {t('securityMap.enableFirewall')}
              </Typography>
            )}
            {!data.isIsolated && data.firewallEnabled && (
              <Typography variant='caption' color='info.main' sx={{ display: 'block', fontSize: '0.65rem' }}>
                • {t('securityMap.applyBaseSg')}
              </Typography>
            )}
          </Box>
        </>
      )}
    </>
  )
}

// ── Edge Details ──

function EdgeDetails({ data, t }: { data: any; t: any }) {
  const statusColor = getFlowStatusColor(data.status)

  return (
    <>
      <Typography variant='subtitle2' fontWeight={700} gutterBottom>
        {t('securityMap.edgeDetails')}
      </Typography>

      <DetailRow label={t('securityMap.flowFrom')} value={data.sourceZone} />
      <DetailRow label={t('securityMap.flowTo')} value={data.targetZone} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: statusColor }} />
        <Typography variant='caption' fontWeight={600} sx={{ color: statusColor }}>
          {data.status.charAt(0).toUpperCase() + data.status.slice(1)}
        </Typography>
      </Box>

      <DetailRow label={t('securityMap.protocolSummary')} value={data.protocolSummary || '-'} />

      <Divider sx={{ my: 1.5 }} />

      <Typography variant='caption' fontWeight={600} gutterBottom>
        {t('securityMap.matchingRules')} ({data.rules.length})
      </Typography>

      {data.rules.length === 0 ? (
        <Typography variant='caption' color='text.secondary'>
          {t('securityMap.noMatchingRules')}
        </Typography>
      ) : (
        <Table size='small' sx={{ mt: 0.5 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontSize: '0.6rem', py: 0.5, px: 0.5 }}>Action</TableCell>
              <TableCell sx={{ fontSize: '0.6rem', py: 0.5, px: 0.5 }}>Proto</TableCell>
              <TableCell sx={{ fontSize: '0.6rem', py: 0.5, px: 0.5 }}>DPort</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.rules.slice(0, 10).map((rule: any, i: number) => (
              <TableRow key={i}>
                <TableCell sx={{ fontSize: '0.6rem', py: 0.3, px: 0.5 }}>
                  <Chip
                    label={rule.action}
                    size='small'
                    color={rule.action === 'ACCEPT' ? 'success' : 'error'}
                    sx={{ fontSize: '0.55rem', height: 18 }}
                  />
                </TableCell>
                <TableCell sx={{ fontSize: '0.6rem', py: 0.3, px: 0.5 }}>
                  {rule.macro || rule.proto || '-'}
                </TableCell>
                <TableCell sx={{ fontSize: '0.6rem', py: 0.3, px: 0.5, fontFamily: 'JetBrains Mono, monospace' }}>
                  {rule.dport || '-'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}

// ── Internet Details ──

function InternetDetails({ t }: { t: any }) {
  return (
    <>
      <Typography variant='subtitle2' fontWeight={700} gutterBottom>
        {t('securityMap.internet')}
      </Typography>
      <Typography variant='caption' color='text.secondary'>
        External network traffic entry point
      </Typography>
    </>
  )
}

// ── Cluster Firewall Details ──

function ClusterFwDetails({ data, t }: { data: any; t: any }) {
  return (
    <>
      <Typography variant='subtitle2' fontWeight={700} gutterBottom>
        {t('securityMap.clusterFirewall')}
      </Typography>

      <DetailRow
        label="Status"
        value={data.enabled ? t('securityMap.enabled') : t('securityMap.disabled')}
        chip={data.enabled ? 'success' : 'error'}
      />
      <DetailRow label={t('securityMap.policyIn')} value={data.policyIn} />
      <DetailRow label={t('securityMap.policyOut')} value={data.policyOut} />
      <DetailRow label={t('securityMap.matchingRules')} value={`${data.ruleCount}`} />
    </>
  )
}

// ── Helper ──

function DetailRow({ label, value, mono, chip }: { label: string; value: string; mono?: boolean; chip?: 'success' | 'error' | 'default' }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.3 }}>
      <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.7rem' }}>
        {label}
      </Typography>
      {chip ? (
        <Chip
          label={value}
          size='small'
          color={chip === 'default' ? 'default' : chip}
          variant='outlined'
          sx={{ fontSize: '0.6rem', height: 20 }}
        />
      ) : (
        <Typography
          variant='caption'
          fontWeight={600}
          sx={{
            fontSize: '0.7rem',
            fontFamily: mono ? 'JetBrains Mono, monospace' : undefined,
          }}
        >
          {value}
        </Typography>
      )}
    </Box>
  )
}
