'use client'

import { useTranslations } from 'next-intl'

import {
  Box,
  Card,
  Chip,
  Divider,
  LinearProgress,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'

interface ReportPreviewProps {
  type: string
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 2.5, mb: 1, textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: '0.05em', color: 'text.secondary' }}>
      {children}
    </Typography>
  )
}

function MiniTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <Table size="small" sx={{ '& td, & th': { py: 0.3, px: 1, fontSize: '0.65rem', border: 'none' }, '& th': { fontWeight: 600, color: 'text.secondary' } }}>
      <TableHead>
        <TableRow>
          {headers.map((h, i) => <TableCell key={i}>{h}</TableCell>)}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={i}>
            {row.map((cell, j) => <TableCell key={j}>{cell}</TableCell>)}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function UsageBar({ label, value }: { label: string; value: number }) {
  return (
    <Box sx={{ mb: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
        <Typography variant="caption" sx={{ fontSize: '0.6rem' }}>{label}</Typography>
        <Typography variant="caption" sx={{ fontSize: '0.6rem', fontWeight: 600 }}>{value}%</Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={value}
        sx={{ height: 4, borderRadius: 2 }}
        color={value > 85 ? 'error' : value > 65 ? 'warning' : 'primary'}
      />
    </Box>
  )
}

function InfrastructureContent({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <>
      <SectionTitle>{t('reports.sectionNames.summary')}</SectionTitle>
      <Box sx={{ display: 'flex', gap: 2, mb: 1.5 }}>
        {[
          { label: 'Nodes', value: '3' },
          { label: 'VMs', value: '24' },
          { label: 'Uptime', value: '98.5%' },
        ].map(kpi => (
          <Box key={kpi.label} sx={{ textAlign: 'center', flex: 1, py: 0.5, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="caption" sx={{ fontSize: '0.55rem', color: 'text.secondary' }}>{kpi.label}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.8rem' }}>{kpi.value}</Typography>
          </Box>
        ))}
      </Box>
      <SectionTitle>{t('reports.sectionNames.clusters')}</SectionTitle>
      <MiniTable
        headers={['Cluster', 'Nodes', 'VMs', 'Status']}
        rows={[
          ['prod-cluster', '3', '24', 'Healthy'],
        ]}
      />
      <SectionTitle>{t('reports.sectionNames.nodes')}</SectionTitle>
      <MiniTable
        headers={['Node', 'CPU', 'RAM', 'Status']}
        rows={[
          ['pve-node-01', '42%', '68%', 'Online'],
          ['pve-node-02', '37%', '55%', 'Online'],
          ['pve-node-03', '61%', '72%', 'Online'],
        ]}
      />
    </>
  )
}

function AlertsContent({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <>
      <SectionTitle>{t('reports.sectionNames.summary')}</SectionTitle>
      <Box sx={{ display: 'flex', gap: 2, mb: 1.5 }}>
        {[
          { label: 'Critical', value: '12', color: 'error.main' },
          { label: 'Warning', value: '28', color: 'warning.main' },
          { label: 'Info', value: '45', color: 'info.main' },
        ].map(s => (
          <Box key={s.label} sx={{ textAlign: 'center', flex: 1, py: 0.5, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="caption" sx={{ fontSize: '0.55rem', color: 'text.secondary' }}>{s.label}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.8rem', color: s.color }}>{s.value}</Typography>
          </Box>
        ))}
      </Box>
      <SectionTitle>{t('reports.sectionNames.statistics')}</SectionTitle>
      <MiniTable
        headers={['Alert', 'Severity', 'Count', 'Last Seen']}
        rows={[
          ['High CPU Usage', 'Critical', '8', '2h ago'],
          ['Disk Space Low', 'Warning', '12', '1h ago'],
          ['Memory Pressure', 'Warning', '6', '3h ago'],
          ['Network Timeout', 'Critical', '4', '30m ago'],
        ]}
      />
    </>
  )
}

function UtilizationContent({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <>
      <SectionTitle>{t('reports.sectionNames.summary')}</SectionTitle>
      <Box sx={{ px: 1, mb: 1.5 }}>
        <UsageBar label="CPU Average" value={47} />
        <UsageBar label="RAM Average" value={65} />
        <UsageBar label="Storage Average" value={58} />
      </Box>
      <SectionTitle>{t('reports.sectionNames.trends')}</SectionTitle>
      <Skeleton variant="rectangular" height={60} sx={{ borderRadius: 1 }} />
    </>
  )
}

function InventoryContent({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <>
      <SectionTitle>{t('reports.sectionNames.summary')}</SectionTitle>
      <Box sx={{ display: 'flex', gap: 2, mb: 1.5 }}>
        {[
          { label: 'VMs', value: '24' },
          { label: 'Containers', value: '8' },
          { label: 'Templates', value: '5' },
        ].map(kpi => (
          <Box key={kpi.label} sx={{ textAlign: 'center', flex: 1, py: 0.5, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="caption" sx={{ fontSize: '0.55rem', color: 'text.secondary' }}>{kpi.label}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.8rem' }}>{kpi.value}</Typography>
          </Box>
        ))}
      </Box>
      <SectionTitle>{t('reports.sectionNames.vms')}</SectionTitle>
      <MiniTable
        headers={['VMID', 'Name', 'Node', 'Status']}
        rows={[
          ['100', 'web-server-01', 'pve-node-01', 'Running'],
          ['101', 'db-primary', 'pve-node-02', 'Running'],
          ['102', 'app-backend', 'pve-node-01', 'Running'],
          ['103', 'monitoring', 'pve-node-03', 'Stopped'],
        ]}
      />
    </>
  )
}

function CapacityContent({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <>
      <SectionTitle>{t('reports.sectionNames.current')}</SectionTitle>
      <Box sx={{ px: 1, mb: 1.5 }}>
        <UsageBar label="CPU Capacity" value={47} />
        <UsageBar label="RAM Capacity" value={72} />
        <UsageBar label="Storage Capacity" value={61} />
      </Box>
      <SectionTitle>{t('reports.sectionNames.predictions')}</SectionTitle>
      <Box sx={{ px: 1, mb: 1 }}>
        <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.secondary' }}>Estimated saturation</Typography>
        <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1, mt: 0.5 }} />
      </Box>
      <SectionTitle>{t('reports.sectionNames.recommendations')}</SectionTitle>
      <Box sx={{ px: 1 }}>
        {[
          'Consider adding RAM to pve-node-03 (72% used)',
          'Storage pool "local-lvm" approaching 80% — plan expansion',
          'CPU headroom sufficient for ~6 additional VMs',
        ].map((rec, i) => (
          <Typography key={i} variant="caption" sx={{ display: 'block', fontSize: '0.6rem', mb: 0.3, '&::before': { content: '"• "' } }}>
            {rec}
          </Typography>
        ))}
      </Box>
    </>
  )
}

function SecurityContent({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <>
      <SectionTitle>{t('reports.sectionNames.summary')}</SectionTitle>
      <Box sx={{ display: 'flex', gap: 2, mb: 1.5 }}>
        {[
          { label: 'Critical', value: '3', color: 'error.main' },
          { label: 'High', value: '8', color: 'warning.main' },
          { label: 'Medium', value: '15', color: 'info.main' },
        ].map(s => (
          <Box key={s.label} sx={{ textAlign: 'center', flex: 1, py: 0.5, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="caption" sx={{ fontSize: '0.55rem', color: 'text.secondary' }}>{s.label}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.8rem', color: s.color }}>{s.value}</Typography>
          </Box>
        ))}
      </Box>
      <SectionTitle>{t('reports.sectionNames.per_node')}</SectionTitle>
      <MiniTable
        headers={['Node', 'Critical', 'High', 'Medium']}
        rows={[
          ['pve-node-01', '1', '3', '5'],
          ['pve-node-02', '1', '2', '6'],
          ['pve-node-03', '1', '3', '4'],
        ]}
      />
    </>
  )
}

function SiteRecoveryContent({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <>
      <SectionTitle>{t('reports.sectionNames.rpo_compliance')}</SectionTitle>
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Chip label="RPO < 1h — 18 VMs" size="small" color="success" sx={{ fontSize: '0.6rem', height: 20 }} />
        <Chip label="RPO < 4h — 4 VMs" size="small" color="warning" sx={{ fontSize: '0.6rem', height: 20 }} />
        <Chip label="RPO Exceeded — 2 VMs" size="small" color="error" sx={{ fontSize: '0.6rem', height: 20 }} />
      </Box>
      <SectionTitle>{t('reports.sectionNames.replication_jobs')}</SectionTitle>
      <MiniTable
        headers={['Job', 'Source', 'Target', 'Status']}
        rows={[
          ['repl-001', 'pve-node-01', 'pve-node-02', 'Active'],
          ['repl-002', 'pve-node-02', 'pve-node-03', 'Active'],
          ['repl-003', 'pve-node-01', 'pve-node-03', 'Delayed'],
        ]}
      />
    </>
  )
}

const contentByType: Record<string, React.FC<{ t: ReturnType<typeof useTranslations> }>> = {
  infrastructure: InfrastructureContent,
  alerts: AlertsContent,
  utilization: UtilizationContent,
  inventory: InventoryContent,
  capacity: CapacityContent,
  security: SecurityContent,
  site_recovery: SiteRecoveryContent,
}

export default function ReportPreview({ type }: ReportPreviewProps) {
  const t = useTranslations()

  const Content = type ? contentByType[type] : null

  return (
    <Card
      variant="outlined"
      sx={{
        position: 'sticky',
        top: 16,
        maxHeight: 'calc(100vh - 220px)',
        overflow: 'auto',
        bgcolor: 'background.paper',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
      }}
    >
      <Box sx={{ p: 2.5, minHeight: 400 }}>
        {!Content ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, color: 'text.disabled' }}>
            <i className="ri-file-pdf-line" style={{ fontSize: 48, marginBottom: 12 }} />
            <Typography variant="body2" color="text.disabled">
              {t('reports.previewHint')}
            </Typography>
          </Box>
        ) : (
          <>
            {/* PDF-like header */}
            <Box sx={{ textAlign: 'center', mb: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, letterSpacing: '0.1em', fontSize: '0.85rem' }}>
                PROXCENTER
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>
                {t(`reports.types.${type}`)}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem' }}>
                Jan 01, 2026 — Feb 21, 2026
              </Typography>
              <Box sx={{ mt: 0.5 }}>
                <Chip
                  label={t('reports.previewSample')}
                  size="small"
                  color="warning"
                  variant="outlined"
                  sx={{ fontSize: '0.55rem', height: 18, fontWeight: 700 }}
                />
              </Box>
            </Box>
            <Divider sx={{ mb: 1 }} />

            {/* Type-specific content */}
            <Content t={t} />
          </>
        )}
      </Box>
    </Card>
  )
}
