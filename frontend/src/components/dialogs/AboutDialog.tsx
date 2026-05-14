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

import { VERSION_NAME, APP_VERSION, GITHUB_URL, GITHUB_REPO } from '@/config/version'
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

interface GHRelease {
  tag_name: string
  published_at: string
  html_url: string
  body: string
}

interface AboutDialogProps {
  open: boolean
  onClose: () => void
}

export default function AboutDialog({ open, onClose }: AboutDialogProps) {
  const t = useTranslations()
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null)
  const [releases, setReleases] = useState<GHRelease[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingReleases, setLoadingReleases] = useState(false)

  useEffect(() => {
    if (open) {
      fetchVersionInfo()
      fetchReleases()
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

  const fetchReleases = async () => {
    setLoadingReleases(true)

    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=10`, {
        headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'ProxCenter' }
      })

      if (res.ok) {
        const data = await res.json()

        setReleases(data.filter((r: any) => !r.draft && !r.prerelease))
      }
    } catch {
      // Ignore - timeline just won't show
    } finally {
      setLoadingReleases(false)
    }
  }

  const isCurrent = (tag: string) => tag.replace(/^v/, '') === APP_VERSION

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
              {!loading && versionInfo && !versionInfo.updateAvailable && !versionInfo.error && (
                <Chip
                  label={t('about.upToDate')}
                  color="success"
                  size="small"
                  sx={{ fontWeight: 600 }}
                />
              )}
            </Box>
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
          </Alert>
        )}

        <Divider sx={{ my: 2 }} />

        {/* Release Timeline */}
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
          {t('about.releaseHistory')}
        </Typography>

        {loadingReleases && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={20} />
          </Box>
        )}

        {!loadingReleases && releases.length > 0 && (
          <Box sx={{ position: 'relative', pl: 3, mb: 2 }}>
            {/* Vertical line */}
            <Box sx={{
              position: 'absolute',
              left: 8,
              top: 4,
              bottom: 4,
              width: 2,
              bgcolor: 'divider',
              borderRadius: 1
            }} />

            {releases.map((release) => {
              const current = isCurrent(release.tag_name)


return (
                <Box key={release.tag_name} sx={{ position: 'relative', mb: 2, '&:last-child': { mb: 0 } }}>
                  {/* Dot */}
                  <Box sx={{
                    position: 'absolute',
                    left: -19,
                    top: 4,
                    width: current ? 14 : 10,
                    height: current ? 14 : 10,
                    borderRadius: '50%',
                    bgcolor: current ? 'primary.main' : 'divider',
                    border: current ? '2px solid' : 'none',
                    borderColor: 'primary.light',
                    mt: current ? '-2px' : 0
                  }} />

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                    <Link
                      href={release.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: '0.8rem',
                        fontWeight: current ? 700 : 600,
                        textDecoration: 'none',
                        color: current ? 'primary.main' : 'text.primary',
                        '&:hover': { textDecoration: 'underline' }
                      }}
                    >
                      {release.tag_name}
                    </Link>
                    {current && (
                      <Chip label={t('about.current')} size="small" color="primary" sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700 }} />
                    )}
                  </Box>

                  <Typography variant="caption" sx={{ opacity: 0.5 }}>
                    {new Date(release.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                  </Typography>
                </Box>
              )
            })}
          </Box>
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
