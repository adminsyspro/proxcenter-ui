'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import PbsStatusChip from './PbsStatusChip'

interface PbsAccessControlTabProps {
  pbsId: string
}

type PbsUserToken = {
  tokenid?: string
  expire?: number | string
  comment?: string
}

type PbsUser = {
  userid?: string
  comment?: string
  email?: string
  enable?: boolean | number | string
  expire?: number | string
  firstname?: string
  lastname?: string
  tokens?: PbsUserToken[]
}

type PbsRole = {
  roleid?: string
  privs?: string | string[]
  special?: boolean | number
}

type PbsAcl = {
  ugid?: string
  ugid_type?: 'user' | 'group' | 'token' | string
  roleid?: string
  path?: string
  propagate?: boolean | number | string
}

type PbsFlatToken = {
  userid: string
  tokenid: string
  fullId: string
  expire?: number | string
  comment?: string
}

function isEnabled(value: boolean | number | string | undefined): boolean {
  if (value === true) return true
  if (value === 1) return true
  if (typeof value === 'string' && (value === '1' || value.toLowerCase() === 'true')) return true
  return false
}

function isPropagate(value: boolean | number | string | undefined): boolean {
  return isEnabled(value)
}

function formatExpire(value: number | string | undefined, neverLabel: string): string {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') return neverLabel
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n) || n <= 0) return neverLabel
  try {
    return new Date((n as number) * 1000).toLocaleString()
  } catch {
    return String(value)
  }
}

function fullName(u: PbsUser): string {
  const parts = [u.firstname, u.lastname].filter(s => typeof s === 'string' && s.trim().length > 0)
  return parts.join(' ').trim()
}

function privsToArray(p: string | string[] | undefined): string[] {
  if (Array.isArray(p)) return p
  if (typeof p === 'string' && p.length > 0) {
    return p
      .split(/[,\s]+/)
      .map(s => s.trim())
      .filter(Boolean)
  }
  return []
}

export default function PbsAccessControlTab({ pbsId }: PbsAccessControlTabProps) {
  const t = useTranslations()

  const [subTab, setSubTab] = useState<number>(0)

  const [users, setUsers] = useState<PbsUser[]>([])
  const [roles, setRoles] = useState<PbsRole[]>([])
  const [acl, setAcl] = useState<PbsAcl[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const [tokenDialogUser, setTokenDialogUser] = useState<PbsUser | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [uRes, rRes, aRes] = await Promise.all([
        fetch(`/api/v1/pbs/${pbsId}/access/users`, { cache: 'no-store' }),
        fetch(`/api/v1/pbs/${pbsId}/access/roles`, { cache: 'no-store' }),
        fetch(`/api/v1/pbs/${pbsId}/access/acl`, { cache: 'no-store' }),
      ])

      for (const r of [uRes, rRes, aRes]) {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body?.error || `HTTP ${r.status}`)
        }
      }

      const [uBody, rBody, aBody] = await Promise.all([uRes.json(), rRes.json(), aRes.json()])

      setUsers(Array.isArray(uBody?.data) ? uBody.data : [])
      setRoles(Array.isArray(rBody?.data) ? rBody.data : [])
      setAcl(Array.isArray(aBody?.data) ? aBody.data : [])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [pbsId])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const flatTokens: PbsFlatToken[] = useMemo(() => {
    const out: PbsFlatToken[] = []
    for (const u of users) {
      if (!u.userid || !Array.isArray(u.tokens)) continue
      for (const tk of u.tokens) {
        const tokenid = tk.tokenid
        if (!tokenid) continue
        out.push({
          userid: u.userid,
          tokenid,
          fullId: `${u.userid}!${tokenid}`,
          expire: tk.expire,
          comment: tk.comment,
        })
      }
    }
    return out
  }, [users])

  const typeChip = (kind?: string) => {
    if (kind === 'user') {
      return (
        <Chip size="small" color="primary" label={t('inventory.pbsAccessTypeUser')} variant="outlined" sx={{ fontSize: 11 }} />
      )
    }
    if (kind === 'group') {
      return (
        <Chip size="small" color="secondary" label={t('inventory.pbsAccessTypeGroup')} variant="outlined" sx={{ fontSize: 11 }} />
      )
    }
    if (kind === 'token') {
      return (
        <Chip size="small" color="warning" label={t('inventory.pbsAccessTypeToken')} variant="outlined" sx={{ fontSize: 11 }} />
      )
    }
    return (
      <Chip size="small" label={kind || '—'} variant="outlined" sx={{ fontSize: 11 }} />
    )
  }

  const enabledChip = (enabled: boolean) =>
    enabled ? (
      <PbsStatusChip color="success" label={t('inventory.pbsAccessEnabled')} sx={{ fontSize: 11 }} />
    ) : (
      <Chip size="small" label={t('inventory.pbsAccessDisabled')} variant="outlined" sx={{ fontSize: 11 }} />
    )

  const propagateChip = (propagate: boolean) =>
    propagate ? (
      <Chip
        size="small"
        color="info"
        variant="outlined"
        label={t('inventory.pbsAccessEnabled')}
        sx={{ fontSize: 11 }}
      />
    ) : (
      <Chip size="small" label={t('inventory.pbsAccessDisabled')} variant="outlined" sx={{ fontSize: 11 }} />
    )

  // Empty state renderer
  const emptyState = (icon: string, title: string) => (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        py: 6,
        opacity: 0.7,
        gap: 1.5,
      }}
    >
      <i className={icon} style={{ fontSize: 64 }} />
      <Typography variant="h6" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      <Typography variant="body2" sx={{ opacity: 0.8 }}>
        {t('inventory.pbsAccessEmptyHint')}
      </Typography>
    </Box>
  )

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="outlined"
            size="small"
            onClick={fetchAll}
            disabled={loading}
            startIcon={<i className="ri-refresh-line" style={{ fontSize: 16 }} />}
          >
            {t('inventory.pbsAccessRefresh')}
          </Button>
        </Stack>
      </Box>

      {/* Sub-tabs */}
      <Tabs
        value={subTab}
        onChange={(_e, v) => setSubTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          minHeight: 36,
          '& .MuiTab-root': { minHeight: 36, py: 0, textTransform: 'none' },
        }}
      >
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className="ri-user-line" style={{ fontSize: 15 }} />
              {t('inventory.pbsAccessUsers')}
            </Box>
          }
        />
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className="ri-key-2-line" style={{ fontSize: 15 }} />
              {t('inventory.pbsAccessTokens')}
            </Box>
          }
        />
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className="ri-shield-user-line" style={{ fontSize: 15 }} />
              {t('inventory.pbsAccessRoles')}
            </Box>
          }
        />
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className="ri-lock-2-line" style={{ fontSize: 15 }} />
              {t('inventory.pbsAccessPermissions')}
            </Box>
          }
        />
      </Tabs>

      {/* Content */}
      {loading && users.length === 0 && roles.length === 0 && acl.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, py: 6 }}>
          <CircularProgress size={32} />
        </Box>
      ) : error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={fetchAll}>
              {t('inventory.pbsAccessRefresh')}
            </Button>
          }
        >
          {t('inventory.pbsAccessLoadError')}: {error}
        </Alert>
      ) : (
        <>
          {/* Users */}
          {subTab === 0 && (
            users.length === 0 ? (
              emptyState('ri-user-line', t('inventory.pbsAccessEmptyUsers'))
            ) : (
              <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('inventory.pbsAccessCol.userId')}</TableCell>
                      <TableCell>{t('inventory.pbsAccessCol.name')}</TableCell>
                      <TableCell>{t('inventory.pbsAccessCol.email')}</TableCell>
                      <TableCell>{t('inventory.pbsAccessCol.enabled')}</TableCell>
                      <TableCell>{t('inventory.pbsAccessCol.expire')}</TableCell>
                      <TableCell>{t('inventory.pbsAccessCol.tokens')}</TableCell>
                      <TableCell>{t('inventory.pbsAccessCol.comment')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {users.map((u, idx) => {
                      const enabled = isEnabled(u.enable)
                      const tokenCount = Array.isArray(u.tokens) ? u.tokens.length : 0
                      return (
                        <TableRow
                          key={u.userid || `user-${idx}`}
                          hover
                          sx={{ cursor: tokenCount > 0 ? 'pointer' : 'default' }}
                          onClick={() => {
                            if (tokenCount > 0) setTokenDialogUser(u)
                          }}
                        >
                          <TableCell sx={{ fontSize: 12 }}>
                            <Typography variant="caption" sx={{ fontWeight: 600 }}>
                              {u.userid || '—'}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ fontSize: 12 }}>
                            <Typography variant="caption">{fullName(u) || '—'}</Typography>
                          </TableCell>
                          <TableCell sx={{ fontSize: 12 }}>
                            <Typography variant="caption">{u.email || '—'}</Typography>
                          </TableCell>
                          <TableCell sx={{ fontSize: 12 }}>{enabledChip(enabled)}</TableCell>
                          <TableCell sx={{ fontSize: 12 }}>
                            <Typography variant="caption">
                              {formatExpire(u.expire, t('inventory.pbsAccessNever'))}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ fontSize: 12 }}>
                            {tokenCount > 0 ? (
                              <Chip
                                size="small"
                                color="warning"
                                variant="outlined"
                                label={tokenCount}
                                sx={{ fontSize: 11, minWidth: 32 }}
                              />
                            ) : (
                              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                —
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, maxWidth: 260 }}>
                            <Typography
                              variant="caption"
                              sx={{
                                display: 'block',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {u.comment || '—'}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )
          )}

          {/* API Tokens */}
          {subTab === 1 && (
            flatTokens.length === 0 ? (
              emptyState('ri-key-2-line', t('inventory.pbsAccessEmptyTokens'))
            ) : (
              <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('inventory.pbsAccessCol.tokenId')}</TableCell>
                      <TableCell>{t('inventory.pbsAccessCol.expire')}</TableCell>
                      <TableCell>{t('inventory.pbsAccessCol.comment')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {flatTokens.map((tk, idx) => (
                      <TableRow key={tk.fullId || `tok-${idx}`} hover>
                        <TableCell sx={{ fontSize: 12 }}>
                          <Typography variant="caption" sx={{ fontWeight: 600 }}>
                            {tk.fullId}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ fontSize: 12 }}>
                          <Typography variant="caption">
                            {formatExpire(tk.expire, t('inventory.pbsAccessNever'))}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ fontSize: 12, maxWidth: 320 }}>
                          <Typography
                            variant="caption"
                            sx={{
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {tk.comment || '—'}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )
          )}

          {/* Roles */}
          {subTab === 2 && (
            roles.length === 0 ? (
              emptyState('ri-shield-user-line', t('inventory.pbsAccessEmptyRoles'))
            ) : (
              <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('inventory.pbsAccessCol.roleId')}</TableCell>
                      <TableCell>{t('inventory.pbsAccessCol.privileges')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {roles.map((r, idx) => {
                      const privs = privsToArray(r.privs)
                      const privsStr = privs.join(', ')
                      return (
                        <TableRow key={r.roleid || `role-${idx}`} hover>
                          <TableCell sx={{ fontSize: 12, minWidth: 160 }}>
                            <Typography variant="caption" sx={{ fontWeight: 600 }}>
                              {r.roleid || '—'}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ fontSize: 12 }}>
                            {privs.length === 0 ? (
                              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                —
                              </Typography>
                            ) : (
                              <Tooltip title={privsStr} placement="top-start">
                                <Typography
                                  variant="caption"
                                  sx={{
                                    display: 'block',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    maxWidth: 640,
                                  }}
                                >
                                  {privsStr}
                                </Typography>
                              </Tooltip>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )
          )}

          {/* Permissions (ACL) */}
          {subTab === 3 && (
            acl.length === 0 ? (
              emptyState('ri-lock-2-line', t('inventory.pbsAccessEmptyPermissions'))
            ) : (
              <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('inventory.pbsAccessCol.path')}</TableCell>
                      <TableCell>{t('inventory.pbsAccessCol.principal')}</TableCell>
                      <TableCell>{t('inventory.pbsAccessCol.type')}</TableCell>
                      <TableCell>{t('inventory.pbsAccessCol.role')}</TableCell>
                      <TableCell>{t('inventory.pbsAccessCol.propagate')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {acl.map((a, idx) => {
                      const propagate = isPropagate(a.propagate)
                      return (
                        <TableRow key={`${a.path}-${a.ugid}-${a.roleid}-${idx}`} hover>
                          <TableCell sx={{ fontSize: 12 }}>
                            <Typography variant="caption" sx={{ fontWeight: 600 }}>
                              {a.path || '—'}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ fontSize: 12 }}>
                            <Typography variant="caption">{a.ugid || '—'}</Typography>
                          </TableCell>
                          <TableCell sx={{ fontSize: 12 }}>{typeChip(a.ugid_type)}</TableCell>
                          <TableCell sx={{ fontSize: 12 }}>
                            <Chip
                              size="small"
                              color="primary"
                              variant="outlined"
                              label={a.roleid || '—'}
                              sx={{ fontSize: 11 }}
                            />
                          </TableCell>
                          <TableCell sx={{ fontSize: 12 }}>{propagateChip(propagate)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )
          )}
        </>
      )}

      {/* Token dialog */}
      <Dialog
        open={Boolean(tokenDialogUser)}
        onClose={() => setTokenDialogUser(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {t('inventory.pbsAccessTokensTitle', { user: tokenDialogUser?.userid || '' })}
        </DialogTitle>
        <DialogContent dividers>
          {!tokenDialogUser || !Array.isArray(tokenDialogUser.tokens) || tokenDialogUser.tokens.length === 0 ? (
            <Typography variant="body2" sx={{ opacity: 0.7 }}>
              {t('inventory.pbsAccessEmptyTokens')}
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('inventory.pbsAccessCol.tokenId')}</TableCell>
                  <TableCell>{t('inventory.pbsAccessCol.expire')}</TableCell>
                  <TableCell>{t('inventory.pbsAccessCol.comment')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tokenDialogUser.tokens.map((tk, idx) => (
                  <TableRow key={tk.tokenid || `tk-${idx}`}>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        {`${tokenDialogUser.userid}!${tk.tokenid || ''}`}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption">
                        {formatExpire(tk.expire, t('inventory.pbsAccessNever'))}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption">{tk.comment || '—'}</Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTokenDialogUser(null)}>
            {t('inventory.pbsAccessClose')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
