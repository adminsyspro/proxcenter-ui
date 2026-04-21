'use client'

import { useEffect, useState } from 'react'
import { Box, Card, CardContent, Typography, Stack, Chip, LinearProgress, alpha, useTheme } from '@mui/material'
import { PieChart, Pie, Cell } from 'recharts'
import ChartContainer from '@/components/ChartContainer'

type ExternalHypervisor = {
  id: string
  name: string
  type: string // 'vmware' | 'hyperv' | 'xcpng' | 'nutanix'
  vms?: Array<{ vmid: string; name: string; status: string }>
}

type MigrationJob = {
  id: string
  sourceVmName?: string
  sourceHost?: string
  targetNode: string
  targetVmid?: number
  status: string
  progress: number
  startedAt?: string
  completedAt?: string
  error?: string
}

type Props = {
  externalHypervisors: ExternalHypervisor[]
  onHostClick?: (sel: { type: 'ext'; id: string }) => void
}

const TYPE_COLORS: Record<string, string> = {
  vmware: '#78B83B',
  hyperv: '#00A4EF',
  xcpng: '#017EC1',
  nutanix: '#24B47E',
}

const TYPE_LABELS: Record<string, string> = {
  vmware: 'VMware ESXi',
  hyperv: 'Hyper-V',
  xcpng: 'XCP-ng',
  nutanix: 'Nutanix AHV',
}

const TYPE_LOGOS: Record<string, string> = {
  vmware: '/images/esxi-logo.svg',
  hyperv: '/images/hyperv-logo.svg',
  xcpng: '/images/xcpng-logo.svg',
  nutanix: '/images/nutanix-logo.svg',
}

function isRunning(status: string): boolean {
  const s = status.toLowerCase()
  return s.includes('running') || s.includes('power')
}

export default function MigrationDashboard({ externalHypervisors, onHostClick }: Props) {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const [recentJobs, setRecentJobs] = useState<MigrationJob[]>([])

  useEffect(() => {
    fetch('/api/v1/migrations')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const jobs = (d?.data || []).slice(0, 10) // Last 10 jobs
        setRecentJobs(jobs)
      })
      .catch(() => {})
  }, [])

  const totalHypervisors = externalHypervisors.length
  const allVms = externalHypervisors.flatMap(h => h.vms ?? [])
  const totalVms = allVms.length
  const runningVms = allVms.filter(vm => isRunning(vm.status)).length

  // Group by type for donut chart
  const typeGroups: Record<string, number> = {}
  for (const h of externalHypervisors) {
    typeGroups[h.type] = (typeGroups[h.type] ?? 0) + 1
  }
  const donutData = Object.entries(typeGroups).map(([type, count]) => ({
    name: TYPE_LABELS[type] ?? type,
    value: count,
    color: TYPE_COLORS[type] ?? '#888',
  }))

  if (totalHypervisors === 0) {
    return (
      <Box sx={{ p: 3 }}>
        {/* Header */}
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: alpha(theme.palette.primary.main, 0.12),
            }}
          >
            <i className="ri-exchange-line" style={{ fontSize: 20, color: theme.palette.primary.main }} />
          </Box>
          <Typography variant="h6" fontWeight={600}>
            Migration Overview
          </Typography>
        </Stack>

        {/* Empty state */}
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            py: 6,
            px: 3,
            borderRadius: 3,
            border: `1.5px dashed ${alpha(theme.palette.text.primary, 0.15)}`,
            bgcolor: alpha(theme.palette.action.hover, 0.3),
            textAlign: 'center',
          }}
        >
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: alpha(theme.palette.info.main, 0.1),
              mb: 2,
            }}
          >
            <i className="ri-exchange-line" style={{ fontSize: 28, color: theme.palette.info.main }} />
          </Box>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
            No external hypervisors configured
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.6, maxWidth: 360 }}>
            Connect your VMware, Hyper-V, Nutanix, or XCP-ng hosts to start planning migrations to Proxmox VE.
          </Typography>
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* KPI row */}
      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <Card variant="outlined" sx={{ flex: 1, borderRadius: 2, bgcolor: alpha(theme.palette.primary.main, 0.04) }}>
          <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <i className="ri-server-line" style={{ fontSize: 18, color: theme.palette.primary.main }} />
              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                Hypervisors
              </Typography>
            </Stack>
            <Typography variant="h5" fontWeight={700}>
              {totalHypervisors}
            </Typography>
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ flex: 1, borderRadius: 2, bgcolor: alpha(theme.palette.info.main, 0.04) }}>
          <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <i className="ri-computer-line" style={{ fontSize: 18, color: theme.palette.info.main }} />
              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                VMs to Migrate
              </Typography>
            </Stack>
            <Typography variant="h5" fontWeight={700}>
              {totalVms}
            </Typography>
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ flex: 1, borderRadius: 2, bgcolor: alpha(theme.palette.success.main, 0.04) }}>
          <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <i className="ri-play-circle-line" style={{ fontSize: 18, color: theme.palette.success.main }} />
              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                Running
              </Typography>
            </Stack>
            <Typography variant="h5" fontWeight={700} color="success.main">
              {runningVms}
            </Typography>
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ flex: 1, borderRadius: 2, bgcolor: alpha(theme.palette.warning.main, 0.04) }}>
          <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <i className="ri-stop-circle-line" style={{ fontSize: 18, color: theme.palette.warning.main }} />
              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                Stopped
              </Typography>
            </Stack>
            <Typography variant="h5" fontWeight={700} color="warning.main">
              {totalVms - runningVms}
            </Typography>
          </CardContent>
        </Card>
      </Stack>

      {/* Breakdown by type donut chart */}
      {donutData.length > 0 && (
        <Card
          variant="outlined"
          sx={{
            borderRadius: 2,
            mb: 3,
            bgcolor: isDark ? alpha('#fff', 0.02) : alpha('#000', 0.01),
          }}
        >
          <CardContent sx={{ py: 2, px: 2.5 }}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 2 }}>
              Breakdown by Type
            </Typography>
            <Stack direction="row" alignItems="center" spacing={3}>
              {/* Donut */}
              <Box sx={{ width: 120, height: 120, flexShrink: 0 }}>
                <ChartContainer>
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={32}
                      outerRadius={52}
                      paddingAngle={3}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {donutData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              </Box>

              {/* Legend */}
              <Stack spacing={1}>
                {donutData.map((entry, index) => {
                  const typeKey = Object.entries(TYPE_LABELS).find(([, v]) => v === entry.name)?.[0] || ''
                  return (
                    <Stack key={index} direction="row" alignItems="center" spacing={1}>
                      {TYPE_LOGOS[typeKey] ? (
                        <img src={TYPE_LOGOS[typeKey]} alt="" width={16} height={16} />
                      ) : (
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                      )}
                      <Typography variant="caption" sx={{ fontWeight: 500 }}>
                        {entry.name}
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: 0.5 }}>
                        ({entry.value})
                      </Typography>
                    </Stack>
                  )
                })}
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* Hypervisor list */}
      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
        Hypervisors
      </Typography>
      <Stack spacing={1.5}>
        {externalHypervisors.map(h => {
          const vms = h.vms ?? []
          const running = vms.filter(vm => isRunning(vm.status)).length
          const stopped = vms.length - running
          const typeColor = TYPE_COLORS[h.type] ?? '#888'
          const typeLabel = TYPE_LABELS[h.type] ?? h.type

          return (
            <Card
              key={h.id}
              variant="outlined"
              onClick={() => onHostClick?.({ type: 'ext', id: h.id })}
              sx={{
                borderRadius: 2,
                cursor: onHostClick ? 'pointer' : 'default',
                transition: 'border-color 0.15s, background 0.15s',
                '&:hover': onHostClick
                  ? {
                      borderColor: typeColor,
                      bgcolor: alpha(typeColor, 0.04),
                    }
                  : {},
              }}
            >
              <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                <Stack direction="row" alignItems="center" spacing={1.5}>
                  {/* Type icon */}
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: 1.5,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: alpha(typeColor, 0.12),
                      flexShrink: 0,
                    }}
                  >
                    {TYPE_LOGOS[h.type] ? (
                      <img src={TYPE_LOGOS[h.type]} alt="" width={18} height={18} />
                    ) : (
                      <i className="ri-server-line" style={{ fontSize: 16, color: typeColor }} />
                    )}
                  </Box>

                  {/* Name + type chip */}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.25 }}>
                      <Typography
                        variant="body2"
                        fontWeight={600}
                        noWrap
                        sx={{ maxWidth: 200 }}
                      >
                        {h.name}
                      </Typography>
                      <Chip
                        label={typeLabel}
                        size="small"
                        sx={{
                          height: 18,
                          fontSize: 10,
                          fontWeight: 600,
                          bgcolor: alpha(typeColor, 0.12),
                          color: typeColor,
                          border: 'none',
                        }}
                      />
                    </Stack>

                    {/* VM stats */}
                    <Stack direction="row" spacing={1.5}>
                      <Stack direction="row" alignItems="center" spacing={0.5}>
                        <i
                          className="ri-stack-line"
                          style={{ fontSize: 12, opacity: 0.5 }}
                        />
                        <Typography variant="caption" sx={{ opacity: 0.6 }}>
                          {vms.length} VM{vms.length !== 1 ? 's' : ''}
                        </Typography>
                      </Stack>

                      {vms.length > 0 && (
                        <>
                          {running > 0 && (
                            <Stack direction="row" alignItems="center" spacing={0.5}>
                              <Box
                                sx={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: '50%',
                                  bgcolor: theme.palette.success.main,
                                }}
                              />
                              <Typography variant="caption" sx={{ color: theme.palette.success.main }}>
                                {running} running
                              </Typography>
                            </Stack>
                          )}
                          {stopped > 0 && (
                            <Stack direction="row" alignItems="center" spacing={0.5}>
                              <Box
                                sx={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: '50%',
                                  bgcolor: theme.palette.text.disabled,
                                }}
                              />
                              <Typography variant="caption" sx={{ opacity: 0.5 }}>
                                {stopped} stopped
                              </Typography>
                            </Stack>
                          )}
                        </>
                      )}
                    </Stack>
                  </Box>

                  {/* Migration direction arrow + Proxmox logo */}
                  <Stack direction="row" alignItems="center" spacing={0.75} sx={{ flexShrink: 0 }}>
                    <i className="ri-arrow-right-line" style={{ fontSize: 14, opacity: 0.3 }} />
                    <img src="/images/proxmox-logo.svg" alt="Proxmox" width={16} height={16} style={{ opacity: 0.5 }} />
                  </Stack>

                  {/* Chevron */}
                  {onHostClick && (
                    <i
                      className="ri-arrow-right-s-line"
                      style={{ fontSize: 18, opacity: 0.4, flexShrink: 0 }}
                    />
                  )}
                </Stack>

                {/* VM list preview (max 5) */}
                {vms.length > 0 && (
                  <Box sx={{ mt: 1, pl: 6.5 }}>
                    {vms.slice(0, 5).map(vm => (
                      <Stack key={vm.vmid} direction="row" alignItems="center" spacing={0.75} sx={{ py: 0.25 }}>
                        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: isRunning(vm.status) ? theme.palette.success.main : theme.palette.text.disabled, flexShrink: 0 }} />
                        <Typography variant="caption" noWrap sx={{ opacity: 0.7, maxWidth: 200 }}>{vm.name}</Typography>
                      </Stack>
                    ))}
                    {vms.length > 5 && (
                      <Typography variant="caption" sx={{ opacity: 0.4, pl: 1.75 }}>+{vms.length - 5} more</Typography>
                    )}
                  </Box>
                )}
              </CardContent>
            </Card>
          )
        })}
      </Stack>

      {/* Recent Migrations */}
      {recentJobs.length > 0 && (
        <>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mt: 3, mb: 1.5 }}>
            Recent Migrations
          </Typography>
          <Stack spacing={1}>
            {recentJobs.map(job => {
              const statusColor = job.status === 'completed' ? theme.palette.success.main
                : job.status === 'failed' ? theme.palette.error.main
                : job.status === 'cancelled' ? theme.palette.warning.main
                : theme.palette.info.main
              const statusIcon = job.status === 'completed' ? 'ri-checkbox-circle-fill'
                : job.status === 'failed' ? 'ri-close-circle-fill'
                : job.status === 'cancelled' ? 'ri-forbid-line'
                : 'ri-loader-4-line'
              const isActive = job.status === 'transferring' || job.status === 'preflight' || job.status === 'creating_vm' || job.status === 'configuring' || job.status === 'pending'
              const duration = job.startedAt && job.completedAt
                ? Math.round((new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)
                : null
              const formatDuration = (s: number) => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`

              return (
                <Card key={job.id} variant="outlined" sx={{ borderRadius: 2, borderColor: isActive ? alpha(statusColor, 0.4) : undefined }}>
                  <CardContent sx={{ py: 1.25, px: 2, '&:last-child': { pb: 1.25 } }}>
                    <Stack direction="row" alignItems="center" spacing={1.5}>
                      <i className={statusIcon} style={{ fontSize: 18, color: statusColor, animation: isActive ? 'spin 1s linear infinite' : undefined }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.25 }}>
                          <Typography variant="body2" fontWeight={600} noWrap>
                            {job.sourceVmName || (job as any).sourceVmId || 'Unknown VM'}
                          </Typography>
                          <i className="ri-arrow-right-line" style={{ fontSize: 12, opacity: 0.3 }} />
                          <Typography variant="caption" sx={{ opacity: 0.5 }} noWrap>
                            {job.targetNode}{job.targetVmid ? ` (VM ${job.targetVmid})` : ''}
                          </Typography>
                        </Stack>
                        {isActive && (
                          <LinearProgress
                            variant="determinate"
                            value={job.progress}
                            sx={{
                              height: 3,
                              borderRadius: 2,
                              bgcolor: alpha(statusColor, 0.12),
                              '& .MuiLinearProgress-bar': { bgcolor: statusColor, borderRadius: 2 },
                            }}
                          />
                        )}
                        {job.status === 'failed' && job.error && (
                          <Typography variant="caption" sx={{ color: 'error.main', fontSize: 10 }} noWrap>
                            {job.error.substring(0, 100)}
                          </Typography>
                        )}
                      </Box>
                      <Stack alignItems="flex-end" sx={{ flexShrink: 0 }}>
                        <Chip
                          label={job.status}
                          size="small"
                          sx={{
                            height: 18,
                            fontSize: 10,
                            fontWeight: 600,
                            bgcolor: alpha(statusColor, 0.12),
                            color: statusColor,
                            border: 'none',
                          }}
                        />
                        {duration != null && (
                          <Typography variant="caption" sx={{ opacity: 0.4, fontSize: 10, mt: 0.25 }}>
                            {formatDuration(duration)}
                          </Typography>
                        )}
                        {isActive && (
                          <Typography variant="caption" sx={{ color: statusColor, fontSize: 10, fontWeight: 600, mt: 0.25 }}>
                            {job.progress}%
                          </Typography>
                        )}
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              )
            })}
          </Stack>
        </>
      )}
    </Box>
  )
}
