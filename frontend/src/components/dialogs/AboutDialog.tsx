'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  IconButton,
  Chip,
  Divider,
  Link,
  CircularProgress,
  Alert,
  Button,
} from '@mui/material'

import { VERSION_NAME, APP_VERSION, GIT_SHA, GITHUB_URL } from '@/config/version'
import { LogoIcon } from '@/components/layout/shared/Logo'

interface VersionInfo {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  releaseUrl: string | null
  releaseNotes: string | null
  releaseDate: string | null
  error: string | null
}

interface AboutDialogProps {
  open: boolean
  onClose: () => void
}

export default function AboutDialog({ open, onClose }: AboutDialogProps) {
  const t = useTranslations()
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      fetchVersionInfo()
    }
  }, [open])

  const fetchVersionInfo = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/version/check')
      const data = await res.json()
      setVersionInfo(data)
    } catch (e) {
      console.error('Failed to check version:', e)
      setVersionInfo({
        currentVersion: APP_VERSION,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        releaseNotes: null,
        releaseDate: null,
        error: 'Failed to check for updates'
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: { borderRadius: 3 }
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <LogoIcon size={40} />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                {VERSION_NAME}
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                {t('about.description')}
              </Typography>
            </Box>
          </Box>
          <IconButton onClick={onClose} size="small">
            <i className="ri-close-line" />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        {/* Version Info */}
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          p: 2,
          bgcolor: 'action.hover',
          borderRadius: 2,
          mb: 2
        }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" sx={{ opacity: 0.6, display: 'block' }}>
              {t('about.currentVersion')}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip
                label={APP_VERSION !== 'dev' ? `v${APP_VERSION}` : 'dev'}
                size="small"
                variant="outlined"
                sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8rem', fontWeight: 700, height: 28 }}
              />
              {loading && <CircularProgress size={16} />}
              {!loading && versionInfo?.updateAvailable && (
                <Chip
                  label={t('about.updateAvailable')}
                  color="warning"
                  size="small"
                  sx={{ fontWeight: 600 }}
                />
              )}
              {!loading && !versionInfo?.updateAvailable && !versionInfo?.error && (
                <Chip
                  label={t('about.upToDate')}
                  color="success"
                  size="small"
                  sx={{ fontWeight: 600 }}
                />
              )}
            </Box>
            {GIT_SHA && (
              <Typography
                variant="caption"
                component="a"
                href={`${GITHUB_URL}/commit/${GIT_SHA}`}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.65rem', opacity: 0.5, textDecoration: 'none', '&:hover': { opacity: 0.8 } }}
              >
                {GIT_SHA.substring(0, 7)}
              </Typography>
            )}
          </Box>

          {versionInfo?.updateAvailable && versionInfo?.latestVersion && (
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" sx={{ opacity: 0.6, display: 'block' }}>
                {t('about.latestVersion')}
              </Typography>
              <Chip
                label={`v${versionInfo.latestVersion}`}
                size="small"
                variant="outlined"
                sx={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: 'warning.main',
                  borderColor: 'warning.main'
                }}
              />
            </Box>
          )}
        </Box>

        {/* Update Available Alert */}
        {versionInfo?.updateAvailable && (
          <Alert
            severity="info"
            sx={{ mb: 2 }}
            action={
              versionInfo.releaseUrl && (
                <Button
                  component={Link}
                  href={versionInfo.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="small"
                  variant="contained"
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  {t('about.viewRelease')}
                </Button>
              )
            }
          >
            <Typography variant="body2">
              {t('about.newVersionAvailable', { version: versionInfo.latestVersion })}
            </Typography>
            {versionInfo.releaseDate && (
              <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mt: 0.5 }}>
                {new Date(versionInfo.releaseDate).toLocaleDateString()}
              </Typography>
            )}
          </Alert>
        )}

        <Divider sx={{ my: 2 }} />

        {/* Links */}
        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
          <Link
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              textDecoration: 'none',
              opacity: 0.7,
              '&:hover': { opacity: 1 }
            }}
          >
            <i className="ri-github-fill" style={{ fontSize: 18 }} />
            <Typography variant="caption">GitHub</Typography>
          </Link>
          <Link
            href={`${GITHUB_URL}/issues`}
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              textDecoration: 'none',
              opacity: 0.7,
              '&:hover': { opacity: 1 }
            }}
          >
            <i className="ri-bug-line" style={{ fontSize: 18 }} />
            <Typography variant="caption">{t('about.reportBug')}</Typography>
          </Link>
          <Link
            href={`${GITHUB_URL}/releases`}
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              textDecoration: 'none',
              opacity: 0.7,
              '&:hover': { opacity: 1 }
            }}
          >
            <i className="ri-price-tag-3-line" style={{ fontSize: 18 }} />
            <Typography variant="caption">{t('about.changelog')}</Typography>
          </Link>
        </Box>

        {/* Copyright */}
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            textAlign: 'center',
            mt: 2,
            opacity: 0.5
          }}
        >
          {new Date().getFullYear()} {VERSION_NAME}. {t('about.copyright')}
        </Typography>
      </DialogContent>
    </Dialog>
  )
}
