'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import {
  Box,
  Button,
  Chip,
  IconButton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'

import type { FirewallRule, SecurityGroup } from './types'
import { ActionChip, MONO_STYLE, formatService } from './shared'

export type TableVariant = 'vm' | 'node'

interface FirewallRulesTableProps {
  rules: FirewallRule[]
  saving: boolean
  draggedRule: number | null
  dragOverRule: number | null
  availableGroups: SecurityGroup[]
  variant: TableVariant
  onAddRuleOpen: () => void
  onAddGroupOpen: () => void
  onToggleRule: (rule: FirewallRule) => void
  onEditRule: (rule: FirewallRule) => void
  onDeleteRule: (pos: number) => void
  onDragStart: (e: React.DragEvent, pos: number) => void
  onDragEnd: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent, pos: number) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent, toPos: number) => void
  /** Extra buttons to render in the header next to Add Rule */
  headerExtra?: React.ReactNode
}

export default function FirewallRulesTable({
  rules,
  saving,
  draggedRule,
  dragOverRule,
  availableGroups,
  variant,
  onAddRuleOpen,
  onAddGroupOpen,
  onToggleRule,
  onEditRule,
  onDeleteRule,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  headerExtra,
}: FirewallRulesTableProps) {
  const theme = useTheme()
  const t = useTranslations()

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className={variant === 'vm' ? 'ri-shield-keyhole-line' : 'ri-shield-line'} style={{ fontSize: 20 }} />
          {t('security.firewall')}
          {rules.length > 0 && (
            <Chip size="small" label={rules.length} sx={{ ml: variant === 'vm' ? 0.5 : 1, height: 20, fontSize: 11 }} />
          )}
        </Typography>
        <Box sx={{ display: 'flex', gap: variant === 'vm' ? 0.5 : 1, alignItems: 'center', flexShrink: 0 }}>
          {headerExtra}
          <Button
            size="small"
            variant="outlined"
            startIcon={<i className="ri-shield-check-line" />}
            onClick={onAddGroupOpen}
            disabled={availableGroups.length === 0}
            sx={variant === 'vm' ? { fontSize: 11 } : undefined}
          >
            Security Group
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<i className="ri-add-line" />}
            onClick={onAddRuleOpen}
            sx={variant === 'vm' ? { fontSize: 11 } : undefined}
          >
            {t('network.addRule')}
          </Button>
        </Box>
      </Box>

      {rules.length === 0 ? (
        <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
          <i className="ri-shield-line" style={{ fontSize: 48, opacity: 0.3 }} />
          <Typography variant="body2" sx={{ mt: 1 }}>{t('common.noData')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t('network.addSecurityGroupOrRule')}
          </Typography>
        </Box>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(theme.palette.background.default, 0.5) }}>
                <TableCell sx={{ fontWeight: 700, width: 30, p: 0.5 }}></TableCell>
                <TableCell sx={{ fontWeight: 700, width: 35 }}>#</TableCell>
                <TableCell sx={{ fontWeight: 700, width: 55 }}>Active</TableCell>
                {variant === 'vm' ? (
                  <>
                    <TableCell sx={{ fontWeight: 700, width: 70 }}>{t('firewall.direction')}</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Source</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Dest</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 100 }}>{t('firewall.service')}</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 90 }}>{t('firewall.action')}</TableCell>
                  </>
                ) : (
                  <>
                    <TableCell sx={{ fontWeight: 700, width: 70 }}>Type</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 180 }}>Action</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Source</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Dest</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 60 }}>Proto</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: 70 }}>Port</TableCell>
                  </>
                )}
                <TableCell sx={{ fontWeight: 700 }}>{t('network.comment')}</TableCell>
                <TableCell sx={{ width: 90 }}></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rules.map((rule) => {
                const isGroup = rule.type === 'group'
                const groupName = isGroup ? (rule.action || 'Unknown') : null
                const isDragging = draggedRule === rule.pos
                const isDragOver = dragOverRule === rule.pos

                return (
                  <TableRow
                    key={rule.pos}
                    hover
                    draggable
                    onDragStart={(e) => onDragStart(e, rule.pos)}
                    onDragEnd={onDragEnd}
                    onDragOver={(e) => onDragOver(e, rule.pos)}
                    onDragLeave={onDragLeave}
                    onDrop={(e) => onDrop(e, rule.pos)}
                    sx={{
                      bgcolor: isGroup ? alpha(theme.palette.primary.main, 0.03) : 'transparent',
                      cursor: 'grab',
                      opacity: isDragging ? 0.5 : 1,
                      borderTop: isDragOver ? `2px solid ${theme.palette.primary.main}` : undefined,
                      transition: 'border-top 0.1s ease',
                      '&:hover': {
                        bgcolor: isGroup ? alpha(theme.palette.primary.main, 0.08) : undefined
                      },
                      '&:active': {
                        cursor: 'grabbing'
                      }
                    }}
                  >
                    {/* Drag Handle */}
                    <TableCell sx={{ p: 0.5, textAlign: 'center', cursor: 'grab' }}>
                      <i className="ri-draggable" style={{ fontSize: 16, color: theme.palette.text.disabled }} />
                    </TableCell>

                    {/* Position */}
                    <TableCell sx={{ color: 'text.secondary', fontSize: 11, p: 0.5 }}>
                      {rule.pos}
                    </TableCell>

                    {/* Active switch */}
                    <TableCell sx={{ p: 0.5 }}>
                      <Switch
                        size="small"
                        checked={rule.enable !== 0}
                        onChange={() => onToggleRule(rule)}
                        disabled={saving}
                        color="success"
                      />
                    </TableCell>

                    {variant === 'vm' ? (
                      <>
                        {/* Direction - colored chips */}
                        <TableCell sx={{ p: 0.5 }}>
                          <Chip
                            label={isGroup ? 'GROUP' : rule.type?.toUpperCase() || 'IN'}
                            size="small"
                            sx={{
                              height: 20, fontSize: 10, fontWeight: 600,
                              bgcolor: isGroup ? alpha('#8b5cf6', 0.22) : rule.type === 'in' ? alpha('#3b82f6', 0.22) : alpha('#ec4899', 0.22),
                              color: isGroup ? '#8b5cf6' : rule.type === 'in' ? '#3b82f6' : '#ec4899'
                            }}
                          />
                        </TableCell>

                        {/* Source */}
                        <TableCell sx={{ ...MONO_STYLE, color: (isGroup || !rule.source) ? 'text.disabled' : 'text.primary', fontSize: 11, p: 0.5 }}>
                          {isGroup ? '-' : (rule.source || 'any')}
                        </TableCell>

                        {/* Dest */}
                        <TableCell sx={{ ...MONO_STYLE, color: (isGroup || !rule.dest) ? 'text.disabled' : 'text.primary', fontSize: 11, p: 0.5 }}>
                          {isGroup ? '-' : (rule.dest || 'any')}
                        </TableCell>

                        {/* Service (proto+port merged) */}
                        <TableCell sx={{ ...MONO_STYLE, fontSize: 11, p: 0.5 }}>
                          {formatService(rule)}
                        </TableCell>

                        {/* Action / Security Group name */}
                        <TableCell sx={{ p: 0.5 }}>
                          {isGroup ? (
                            <Chip
                              icon={<i className="ri-shield-line" style={{ fontSize: 10 }} />}
                              label={groupName}
                              size="small"
                              sx={{
                                height: 22, fontSize: 10, fontWeight: 600,
                                bgcolor: alpha('#8b5cf6', 0.22), color: '#8b5cf6',
                                '& .MuiChip-icon': { color: '#8b5cf6' }
                              }}
                            />
                          ) : (
                            <ActionChip action={rule.action || 'ACCEPT'} />
                          )}
                        </TableCell>
                      </>
                    ) : (
                      <>
                        {/* Type */}
                        <TableCell sx={{ p: 0.5 }}>
                          {isGroup ? (
                            <Chip
                              label="GROUP"
                              size="small"
                              sx={{
                                fontSize: 10,
                                height: 20,
                                bgcolor: alpha(theme.palette.primary.main, 0.1),
                                color: theme.palette.primary.main,
                                fontWeight: 600
                              }}
                            />
                          ) : (
                            <Chip
                              label={rule.type?.toUpperCase()}
                              size="small"
                              variant="outlined"
                              sx={{ fontSize: 10, height: 20 }}
                            />
                          )}
                        </TableCell>

                        {/* Action */}
                        <TableCell sx={{ p: 0.5 }}>
                          {isGroup ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <i className="ri-shield-check-line" style={{ fontSize: 14, color: theme.palette.primary.main, flexShrink: 0 }} />
                              <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>
                                {groupName}
                              </Typography>
                            </Box>
                          ) : (
                            <ActionChip action={rule.action || 'ACCEPT'} />
                          )}
                        </TableCell>

                        {/* Source */}
                        <TableCell sx={{ ...MONO_STYLE, color: rule.source ? 'text.primary' : 'text.disabled', fontSize: 11, p: 0.5 }}>
                          {isGroup ? '-' : (rule.source || 'any')}
                        </TableCell>

                        {/* Dest */}
                        <TableCell sx={{ ...MONO_STYLE, color: rule.dest ? 'text.primary' : 'text.disabled', fontSize: 11, p: 0.5 }}>
                          {isGroup ? '-' : (rule.dest || 'any')}
                        </TableCell>

                        {/* Proto */}
                        <TableCell sx={{ ...MONO_STYLE, fontSize: 11, p: 0.5 }}>
                          {isGroup ? '-' : (rule.proto || 'any')}
                        </TableCell>

                        {/* Port */}
                        <TableCell sx={{ ...MONO_STYLE, color: rule.dport ? 'text.primary' : 'text.disabled', fontSize: 11, p: 0.5 }}>
                          {isGroup ? '-' : (rule.dport || '-')}
                        </TableCell>
                      </>
                    )}

                    {/* Comment */}
                    <TableCell sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', p: 0.5 }}>
                      <Tooltip title={rule.comment || ''}>
                        <span style={{ fontSize: 11 }}>{rule.comment || '-'}</span>
                      </Tooltip>
                    </TableCell>

                    {/* Actions */}
                    <TableCell sx={{ p: 0.5 }}>
                      <Box sx={{ display: 'flex', gap: 0 }}>
                        <Tooltip title={t('common.edit')}>
                          <IconButton size="small" onClick={() => onEditRule(rule)}>
                            <i className="ri-edit-line" style={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('common.delete')}>
                          <IconButton size="small" color="error" onClick={() => onDeleteRule(rule.pos)}>
                            <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        {t('network.rulesEvaluatedTopBottom')}
      </Typography>
    </>
  )
}
