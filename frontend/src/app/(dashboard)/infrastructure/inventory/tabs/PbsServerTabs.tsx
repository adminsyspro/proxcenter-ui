'use client'

import React from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  Tab,
  Tabs,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import { AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import ChartContainer from '@/components/ChartContainer'
import { formatBytes } from '@/utils/format'
import { getDateLocale } from '@/lib/i18n/date'
import type { InventorySelection, DetailsPayload } from '../types'
import PbsAccessControlTab from './pbs/PbsAccessControlTab'
import PbsCertificatesTab from './pbs/PbsCertificatesTab'
import PbsDisksTab from './pbs/PbsDisksTab'
import PbsNotesTab from './pbs/PbsNotesTab'
import PbsNotificationsTab from './pbs/PbsNotificationsTab'
import PbsRemotesTab from './pbs/PbsRemotesTab'
import PbsRepositoriesTab from './pbs/PbsRepositoriesTab'
import PbsS3EndpointsTab from './pbs/PbsS3EndpointsTab'
import PbsServicesTab from './pbs/PbsServicesTab'
import PbsShellTab from './pbs/PbsShellTab'
import PbsSubscriptionTab from './pbs/PbsSubscriptionTab'
import PbsSyslogTab from './pbs/PbsSyslogTab'
import PbsTapeBackupTab from './pbs/PbsTapeBackupTab'
import PbsTasksTab from './pbs/PbsTasksTab'
import PbsTrafficControlTab from './pbs/PbsTrafficControlTab'
import PbsUpdatesTab from './pbs/PbsUpdatesTab'

type Timeframe = 'hour' | 'day' | 'week' | 'month' | 'year'

interface PbsServerTabsProps {
  selection: InventorySelection | null
  data: DetailsPayload | null
  onSelect?: (sel: InventorySelection) => void
  pbsServerTab: number
  setPbsServerTab: (v: number) => void
  pbsTimeframe: Timeframe
  setPbsTimeframe: (v: Timeframe) => void
  pbsRrdData: any[]
}

const TAB_DEFS: Array<{ key: string; icon: string }> = [
  { key: 'pbsTabServerStatus', icon: 'ri-line-chart-line' },
  { key: 'pbsTabNotes', icon: 'ri-file-text-line' },
  { key: 'pbsTabServices', icon: 'ri-settings-3-line' },
  { key: 'pbsTabUpdates', icon: 'ri-download-cloud-line' },
  { key: 'pbsTabRepositories', icon: 'ri-database-line' },
  { key: 'pbsTabSyslog', icon: 'ri-file-list-3-line' },
  { key: 'pbsTabTasks', icon: 'ri-task-line' },
  { key: 'pbsTabShell', icon: 'ri-terminal-box-line' },
  { key: 'pbsTabStorageDisks', icon: 'ri-hard-drive-2-line' },
  { key: 'pbsTabAccessControl', icon: 'ri-lock-password-line' },
  { key: 'pbsTabRemotes', icon: 'ri-server-line' },
  { key: 'pbsTabS3Endpoints', icon: 'ri-cloud-line' },
  { key: 'pbsTabTrafficControl', icon: 'ri-speed-up-line' },
  { key: 'pbsTabCertificates', icon: 'ri-shield-keyhole-line' },
  { key: 'pbsTabNotifications', icon: 'ri-notification-3-line' },
  { key: 'pbsTabSubscription', icon: 'ri-vip-crown-line' },
  { key: 'pbsTabTapeBackup', icon: 'ri-hard-drive-3-line' },
]

export default function PbsServerTabs({
  selection,
  data,
  onSelect,
  pbsServerTab,
  setPbsServerTab,
  pbsTimeframe,
  setPbsTimeframe,
  pbsRrdData,
}: PbsServerTabsProps) {
  const t = useTranslations()
  const theme = useTheme()
  const dateLocale = getDateLocale(useLocale())
  const primaryColor = theme.palette.primary.main
  const primaryColorLight = alpha(primaryColor, 0.6)

  if (!selection || selection.type !== 'pbs' || !data?.pbsInfo) return null

  const pbsInfo = data.pbsInfo
  const rrdDataToUse = pbsRrdData.length > 0 ? pbsRrdData : (pbsInfo.rrdData || [])

  return (
    <Card
      variant="outlined"
      sx={{
        width: '100%',
        borderRadius: 2,
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Tabs
        value={pbsServerTab}
        onChange={(_e, v) => setPbsServerTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          px: 2,
          minHeight: 40,
          flexShrink: 0,
          '& .MuiTab-root': { minHeight: 40, py: 0 },
        }}
      >
        {TAB_DEFS.map(({ key, icon }) => (
          <Tab
            key={key}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <i className={icon} style={{ fontSize: 16 }} />
                {t(`inventory.${key}`)}
              </Box>
            }
          />
        ))}
      </Tabs>

      <CardContent
        sx={{
          p: 0,
          '&:last-child': { pb: 0 },
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
        }}
      >
        {/* Tab 0: Server Status */}
        {pbsServerTab === 0 && (
          <Stack spacing={2} sx={{ p: 2 }}>
            {/* Datastores list */}
            <Card variant="outlined" sx={{ width: '100%', borderRadius: 2 }}>
              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                <Box
                  sx={{
                    px: 2,
                    py: 1.5,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-database-2-line" style={{ fontSize: 18, opacity: 0.7 }} />
                    Datastores ({pbsInfo.datastores.length})
                  </Typography>
                </Box>
                <Box sx={{ maxHeight: 250, overflow: 'auto' }}>
                  {pbsInfo.datastores.map((ds: any) => (
                    <Box
                      key={ds.name}
                      sx={{
                        px: 2,
                        py: 1.5,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        '&:last-child': { borderBottom: 'none' },
                        '&:hover': { bgcolor: 'action.hover' },
                        cursor: 'pointer',
                      }}
                      onClick={() => onSelect?.({ type: 'datastore', id: `${selection.id}:${ds.name}` })}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className="ri-hard-drive-2-line" style={{ fontSize: 16, opacity: 0.7 }} />
                          <Typography variant="body2" fontWeight={600}>
                            {ds.name}
                          </Typography>
                          {ds.comment && (
                            <Typography variant="caption" sx={{ opacity: 0.5 }}>
                              ({ds.comment})
                            </Typography>
                          )}
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box
                          sx={{
                            flex: 1,
                            height: 14,
                            bgcolor: theme.palette.mode === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)',
                            borderRadius: 0,
                            overflow: 'hidden',
                          }}
                        >
                          <Box
                            sx={{
                              width: `${ds.usagePercent || 0}%`,
                              height: '100%',
                              background: 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)',
                              backgroundSize: (ds.usagePercent || 0) > 0 ? `${(100 / (ds.usagePercent || 1)) * 100}% 100%` : '100% 100%',
                              transition: 'width 0.3s ease',
                            }}
                          />
                        </Box>
                        <Typography variant="caption" sx={{ opacity: 0.6, minWidth: 50 }}>
                          {ds.usagePercent || 0}%
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.5, minWidth: 140, textAlign: 'right' }}>
                          {ds.usedFormatted || formatBytes(ds.used || 0)} / {ds.totalFormatted || formatBytes(ds.total || 0)}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </CardContent>
            </Card>

            {/* 6 RRD charts (visual shape identical to previous PbsServerPanel rendering) */}
            {rrdDataToUse.length > 0 && (
              <Card variant="outlined" sx={{ width: '100%', borderRadius: 2 }}>
                <CardContent sx={{ p: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                    <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-line-chart-line" style={{ fontSize: 18 }} /> Server Statistics
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {[
                        { value: 'hour', label: '1h' },
                        { value: 'day', label: '24h' },
                        { value: 'week', label: t('inventory.pbsTimeWeek') },
                        { value: 'month', label: t('inventory.pbsTimeMonth') },
                        { value: 'year', label: t('inventory.pbsTimeYear') },
                      ].map(opt => (
                        <Chip
                          key={opt.value}
                          label={opt.label}
                          size="small"
                          onClick={() => setPbsTimeframe(opt.value as Timeframe)}
                          sx={{
                            height: 24,
                            fontSize: 11,
                            fontWeight: 600,
                            bgcolor: pbsTimeframe === opt.value ? 'primary.main' : 'action.hover',
                            color: pbsTimeframe === opt.value ? 'primary.contrastText' : 'text.secondary',
                            '&:hover': { bgcolor: pbsTimeframe === opt.value ? 'primary.dark' : 'action.selected' },
                            cursor: 'pointer',
                          }}
                        />
                      ))}
                    </Box>
                  </Box>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 2 }}>
                    {/* 1. CPU Usage (cpu + iowait) */}
                    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                      <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                        CPU Usage
                      </Typography>
                      <Box sx={{ height: 160 }}>
                        <ChartContainer>
                          <AreaChart data={rrdDataToUse}>
                            <XAxis
                              dataKey="time"
                              tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}
                              minTickGap={40}
                              tick={{ fontSize: 9 }}
                            />
                            <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} width={30} />
                            <Tooltip
                              wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                              content={({ active, payload, label }) => {
                                if (!active || !payload?.length) return null
                                return (
                                  <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                                    <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#2196f3', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                      <i className="ri-cpu-line" style={{ fontSize: 13, color: '#2196f3' }} />
                                      <Typography variant="caption" sx={{ fontWeight: 700, color: '#2196f3' }}>CPU</Typography>
                                      <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label) * 1000).toLocaleTimeString()}</Typography>
                                    </Box>
                                    <Box sx={{ px: 1.5, py: 0.75 }}>
                                      {payload.map(entry => (
                                        <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                          <Typography variant="caption" sx={{ flex: 1 }}>{entry.name === 'cpu' ? 'CPU' : 'IO Wait'}</Typography>
                                          <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{Number(entry.value).toFixed(1)}%</Typography>
                                        </Box>
                                      ))}
                                    </Box>
                                  </Box>
                                )
                              }}
                            />
                            <Area type="monotone" dataKey="cpu" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="cpu" />
                            <Area type="monotone" dataKey="iowait" stroke={primaryColorLight} fill={primaryColorLight} fillOpacity={0.3} strokeWidth={1} isAnimationActive={false} name="iowait" />
                          </AreaChart>
                        </ChartContainer>
                      </Box>
                    </Box>

                    {/* 2. Server Load (loadavg) */}
                    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                      <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                        Server Load
                      </Typography>
                      <Box sx={{ height: 160 }}>
                        <ChartContainer>
                          <AreaChart data={rrdDataToUse}>
                            <XAxis
                              dataKey="time"
                              tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}
                              minTickGap={40}
                              tick={{ fontSize: 9 }}
                            />
                            <YAxis tick={{ fontSize: 9 }} width={30} />
                            <Tooltip
                              wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                              content={({ active, payload, label }) => {
                                if (!active || !payload?.length) return null
                                return (
                                  <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                                    <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#f59e0b', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                      <i className="ri-bar-chart-line" style={{ fontSize: 13, color: '#f59e0b' }} />
                                      <Typography variant="caption" sx={{ fontWeight: 700, color: '#f59e0b' }}>Server Load</Typography>
                                      <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label) * 1000).toLocaleTimeString()}</Typography>
                                    </Box>
                                    <Box sx={{ px: 1.5, py: 0.75 }}>
                                      {payload.map(entry => (
                                        <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                          <Typography variant="caption" sx={{ flex: 1 }}>Load Average</Typography>
                                          <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{Number(entry.value).toFixed(2)}</Typography>
                                        </Box>
                                      ))}
                                    </Box>
                                  </Box>
                                )
                              }}
                            />
                            <Area type="monotone" dataKey="loadavg" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} />
                          </AreaChart>
                        </ChartContainer>
                      </Box>
                    </Box>

                    {/* 3. Memory Usage (memused + memtotal) */}
                    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                      <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                        Memory Usage
                      </Typography>
                      <Box sx={{ height: 160 }}>
                        <ChartContainer>
                          <AreaChart data={rrdDataToUse}>
                            <XAxis
                              dataKey="time"
                              tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}
                              minTickGap={40}
                              tick={{ fontSize: 9 }}
                            />
                            <YAxis tickFormatter={v => formatBytes(v)} tick={{ fontSize: 9 }} width={45} />
                            <Tooltip
                              wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                              content={({ active, payload, label }) => {
                                if (!active || !payload?.length) return null
                                return (
                                  <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                                    <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#10b981', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                      <i className="ri-ram-line" style={{ fontSize: 13, color: '#10b981' }} />
                                      <Typography variant="caption" sx={{ fontWeight: 700, color: '#10b981' }}>Memory</Typography>
                                      <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label) * 1000).toLocaleTimeString()}</Typography>
                                    </Box>
                                    <Box sx={{ px: 1.5, py: 0.75 }}>
                                      {payload.map(entry => (
                                        <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                          <Typography variant="caption" sx={{ flex: 1 }}>{entry.name === 'memused' ? 'Usage' : 'Total'}</Typography>
                                          <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBytes(Number(entry.value))}</Typography>
                                        </Box>
                                      ))}
                                    </Box>
                                  </Box>
                                )
                              }}
                            />
                            <Area type="monotone" dataKey="memtotal" stroke={primaryColor} fill={primaryColor} fillOpacity={0.2} strokeWidth={1} isAnimationActive={false} name="memtotal" />
                            <Area type="monotone" dataKey="memused" stroke={primaryColor} fill={primaryColor} fillOpacity={0.5} strokeWidth={1.5} isAnimationActive={false} name="memused" />
                          </AreaChart>
                        </ChartContainer>
                      </Box>
                    </Box>

                    {/* 4. Swap Usage (swapused + swaptotal) */}
                    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                      <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                        Swap Usage
                      </Typography>
                      <Box sx={{ height: 160 }}>
                        <ChartContainer>
                          <AreaChart data={rrdDataToUse}>
                            <XAxis
                              dataKey="time"
                              tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}
                              minTickGap={40}
                              tick={{ fontSize: 9 }}
                            />
                            <YAxis tickFormatter={v => formatBytes(v)} tick={{ fontSize: 9 }} width={45} />
                            <Tooltip
                              wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                              content={({ active, payload, label }) => {
                                if (!active || !payload?.length) return null
                                return (
                                  <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                                    <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#8b5cf6', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                      <i className="ri-swap-line" style={{ fontSize: 13, color: '#8b5cf6' }} />
                                      <Typography variant="caption" sx={{ fontWeight: 700, color: '#8b5cf6' }}>Swap</Typography>
                                      <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label) * 1000).toLocaleTimeString()}</Typography>
                                    </Box>
                                    <Box sx={{ px: 1.5, py: 0.75 }}>
                                      {payload.map(entry => (
                                        <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                          <Typography variant="caption" sx={{ flex: 1 }}>{entry.name === 'swapused' ? 'Usage' : 'Total'}</Typography>
                                          <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBytes(Number(entry.value))}</Typography>
                                        </Box>
                                      ))}
                                    </Box>
                                  </Box>
                                )
                              }}
                            />
                            <Area type="monotone" dataKey="swaptotal" stroke={primaryColor} fill={primaryColor} fillOpacity={0.2} strokeWidth={1} isAnimationActive={false} name="swaptotal" />
                            <Area type="monotone" dataKey="swapused" stroke={primaryColor} fill={primaryColor} fillOpacity={0.5} strokeWidth={1.5} isAnimationActive={false} name="swapused" />
                          </AreaChart>
                        </ChartContainer>
                      </Box>
                    </Box>

                    {/* 5. Network Traffic (netin + netout) */}
                    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                      <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                        Network Traffic
                      </Typography>
                      <Box sx={{ height: 160 }}>
                        <ChartContainer>
                          <AreaChart data={rrdDataToUse}>
                            <XAxis
                              dataKey="time"
                              tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}
                              minTickGap={40}
                              tick={{ fontSize: 9 }}
                            />
                            <YAxis tickFormatter={v => formatBytes(v) + '/s'} tick={{ fontSize: 9 }} width={55} />
                            <Tooltip
                              wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                              content={({ active, payload, label }) => {
                                if (!active || !payload?.length) return null
                                return (
                                  <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                                    <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#06b6d4', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                      <i className="ri-exchange-line" style={{ fontSize: 13, color: '#06b6d4' }} />
                                      <Typography variant="caption" sx={{ fontWeight: 700, color: '#06b6d4' }}>Network</Typography>
                                      <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label) * 1000).toLocaleTimeString()}</Typography>
                                    </Box>
                                    <Box sx={{ px: 1.5, py: 0.75 }}>
                                      {payload.map(entry => (
                                        <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                          <Typography variant="caption" sx={{ flex: 1 }}>{entry.name === 'netin' ? 'In' : 'Out'}</Typography>
                                          <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBytes(Number(entry.value))}/s</Typography>
                                        </Box>
                                      ))}
                                    </Box>
                                  </Box>
                                )
                              }}
                            />
                            <Area type="monotone" dataKey="netin" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="netin" />
                            <Area type="monotone" dataKey="netout" stroke={primaryColorLight} fill={primaryColorLight} fillOpacity={0.3} strokeWidth={1} isAnimationActive={false} name="netout" />
                          </AreaChart>
                        </ChartContainer>
                      </Box>
                    </Box>

                    {/* 6. Root Disk Usage (rootused + roottotal) */}
                    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                      <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                        Root Disk Usage
                      </Typography>
                      <Box sx={{ height: 160 }}>
                        <ChartContainer>
                          <AreaChart data={rrdDataToUse}>
                            <XAxis
                              dataKey="time"
                              tickFormatter={v => new Date(v * 1000).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}
                              minTickGap={40}
                              tick={{ fontSize: 9 }}
                            />
                            <YAxis tickFormatter={v => formatBytes(v)} tick={{ fontSize: 9 }} width={45} />
                            <Tooltip
                              wrapperStyle={{ backgroundColor: 'transparent', boxShadow: 'none' }}
                              content={({ active, payload, label }) => {
                                if (!active || !payload?.length) return null
                                return (
                                  <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 180 }}>
                                    <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#ef4444', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                      <i className="ri-hard-drive-2-line" style={{ fontSize: 13, color: '#ef4444' }} />
                                      <Typography variant="caption" sx={{ fontWeight: 700, color: '#ef4444' }}>Root Disk</Typography>
                                      <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label) * 1000).toLocaleTimeString()}</Typography>
                                    </Box>
                                    <Box sx={{ px: 1.5, py: 0.75 }}>
                                      {payload.map(entry => (
                                        <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                          <Typography variant="caption" sx={{ flex: 1 }}>{entry.name === 'rootused' ? 'Usage' : 'Total'}</Typography>
                                          <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBytes(Number(entry.value))}</Typography>
                                        </Box>
                                      ))}
                                    </Box>
                                  </Box>
                                )
                              }}
                            />
                            <Area type="monotone" dataKey="roottotal" stroke={primaryColor} fill={primaryColor} fillOpacity={0.2} strokeWidth={1} isAnimationActive={false} name="roottotal" />
                            <Area type="monotone" dataKey="rootused" stroke={primaryColor} fill={primaryColor} fillOpacity={0.5} strokeWidth={1.5} isAnimationActive={false} name="rootused" />
                          </AreaChart>
                        </ChartContainer>
                      </Box>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            )}
          </Stack>
        )}

        {/* Tab 1: Notes */}
        {pbsServerTab === 1 && <PbsNotesTab pbsId={selection.id} />}

        {/* Tab 2: Services */}
        {pbsServerTab === 2 && <PbsServicesTab pbsId={selection.id} />}

        {/* Tab 3: Updates */}
        {pbsServerTab === 3 && <PbsUpdatesTab pbsId={selection.id} />}

        {/* Tab 4: Repositories */}
        {pbsServerTab === 4 && <PbsRepositoriesTab pbsId={selection.id} />}

        {/* Tab 5: Syslog */}
        {pbsServerTab === 5 && <PbsSyslogTab pbsId={selection.id} />}

        {/* Tab 6: Tasks */}
        {pbsServerTab === 6 && <PbsTasksTab pbsId={selection.id} />}

        {/* Tab 7: Shell */}
        {pbsServerTab === 7 && <PbsShellTab pbsId={selection.id} />}

        {/* Tab 8: Storage / Disks */}
        {pbsServerTab === 8 && <PbsDisksTab pbsId={selection.id} />}

        {/* Tab 9: Access Control */}
        {pbsServerTab === 9 && <PbsAccessControlTab pbsId={selection.id} />}

        {/* Tab 10: Remotes */}
        {pbsServerTab === 10 && <PbsRemotesTab pbsId={selection.id} />}

        {/* Tab 11: S3 Endpoints */}
        {pbsServerTab === 11 && <PbsS3EndpointsTab pbsId={selection.id} />}

        {/* Tab 12: Traffic Control */}
        {pbsServerTab === 12 && <PbsTrafficControlTab pbsId={selection.id} />}

        {/* Tab 13: Certificates */}
        {pbsServerTab === 13 && <PbsCertificatesTab pbsId={selection.id} />}

        {/* Tab 14: Notifications */}
        {pbsServerTab === 14 && <PbsNotificationsTab pbsId={selection.id} />}

        {/* Tab 15: Subscription */}
        {pbsServerTab === 15 && <PbsSubscriptionTab pbsId={selection.id} />}

        {/* Tab 16: Tape Backup */}
        {pbsServerTab === 16 && <PbsTapeBackupTab pbsId={selection.id} />}
      </CardContent>
    </Card>
  )
}
