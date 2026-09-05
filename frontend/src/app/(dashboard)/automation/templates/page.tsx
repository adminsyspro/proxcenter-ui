'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams, useRouter } from 'next/navigation'
import { Box, Card, Tab, Tabs } from '@mui/material'

import { usePageTitle } from '@/contexts/PageTitleContext'
import type { CloudImage } from '@/lib/templates/cloudImages'
import { ImageCatalogTab, BlueprintsTab, DeploymentsTab, DeployWizard } from '@/components/templates'
import { TableSkeleton } from '@/components/skeletons'
import { getImageBySlug } from '@/lib/templates/cloudImages'

/**
 * Resolve an image slug for a blueprint or a retry. The catalog API knows the
 * remote catalog (images added since this release) and the custom images; the
 * embedded list is the offline fallback and still resolves a slug the remote
 * catalog retired.
 */
async function resolveImage(slug: string): Promise<CloudImage | null> {
  try {
    const res = await fetch('/api/v1/templates/catalog')
    const data = await res.json()
    const fromApi = (data.data?.images || []).find((img: any) => img.slug === slug)
    if (fromApi) return fromApi
  } catch { /* fall through to the embedded list */ }
  return getImageBySlug(slug) || null
}

export default function TemplatesPage() {
  const t = useTranslations()
  const { setPageInfo } = usePageTitle()
  const [mounted, setMounted] = useState(false)
  const [tab, setTab] = useState(0)

  // Deploy wizard state
  const [wizardOpen, setWizardOpen] = useState(false)
  const [selectedImage, setSelectedImage] = useState<CloudImage | null>(null)
  const [selectedBlueprint, setSelectedBlueprint] = useState<any | null>(null)
  // Resume mode — set when the user clicks an active deployment in the
  // navbar TasksDropdown. The wizard reopens at the Progress step bound
  // to this deployment id and the form fields stay hidden.
  const [resumeDeploymentId, setResumeDeploymentId] = useState<string | null>(null)

  // Read the resume deployment id from the URL on mount. Cleared from
  // the URL once consumed so a refresh doesn't reopen the same dialog.
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    const depId = searchParams?.get('deployment')
    if (!depId) return
    setResumeDeploymentId(depId)
    setSelectedImage(null)
    setSelectedBlueprint(null)
    setWizardOpen(true)
    // Strip the query param so a second mount (back-button) doesn't
    // trigger another reopen.
    const url = new URL(window.location.href)
    url.searchParams.delete('deployment')
    router.replace(url.pathname + (url.search || ''), { scroll: false })
  }, [searchParams, router])

  useEffect(() => {
    setPageInfo(t('templates.title'), t('templates.catalogSubtitle'), 'ri-instance-line')
    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  const handleDeployImage = useCallback((image: CloudImage) => {
    setSelectedImage(image)
    setSelectedBlueprint(null)
    setWizardOpen(true)
  }, [])

  const handleDeployBlueprint = useCallback(async (blueprint: any) => {
    const image = await resolveImage(blueprint.imageSlug)
    setSelectedImage(image || null)
    setSelectedBlueprint(blueprint)
    setWizardOpen(true)
  }, [])

  const handleWizardClose = useCallback(() => {
    setWizardOpen(false)
    setSelectedImage(null)
    setSelectedBlueprint(null)
    setResumeDeploymentId(null)
  }, [])

  const handleRetryDeployment = useCallback(async (deployment: any) => {
    const image = deployment.imageSlug ? await resolveImage(deployment.imageSlug) : null
    setSelectedImage(image || null)

    // Build a prefill object from the deployment's saved config. Since
    // step 2.5 the API returns config as a parsed object; tolerate the
    // legacy string shape for older cached clients.
    let config: any = null
    if (deployment.config) {
      if (typeof deployment.config === 'string') {
        try { config = JSON.parse(deployment.config) } catch { /* ignore */ }
      } else {
        config = deployment.config
      }
    }

    setSelectedBlueprint({
      imageSlug: deployment.imageSlug,
      hardware: config?.hardware ? JSON.stringify(config.hardware) : null,
      cloudInit: config?.cloudInit ? JSON.stringify(config.cloudInit) : null,
      _retryFrom: {
        connectionId: deployment.connectionId,
        node: deployment.node,
        storage: config?.storage,
        vmName: config?.vmName,
      },
    })
    setWizardOpen(true)
  }, [])

  if (!mounted) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}>
        <TableSkeleton rows={5} columns={4} />
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      <Card variant="outlined" sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab
              label={t('templates.tabs.catalog')}
              icon={<i className="ri-cloud-line" style={{ fontSize: 18 }} />}
              iconPosition="start"
              sx={{ minHeight: 48 }}
            />
            <Tab
              label={t('templates.tabs.blueprints')}
              icon={<i className="ri-draft-line" style={{ fontSize: 18 }} />}
              iconPosition="start"
              sx={{ minHeight: 48 }}
            />
            <Tab
              label={t('templates.tabs.deployments')}
              icon={<i className="ri-rocket-2-line" style={{ fontSize: 18 }} />}
              iconPosition="start"
              sx={{ minHeight: 48 }}
            />
          </Tabs>
        </Box>

        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'auto' }}>
          {tab === 0 && <ImageCatalogTab onDeploy={handleDeployImage} />}
          {tab === 1 && <BlueprintsTab onDeploy={handleDeployBlueprint} />}
          {tab === 2 && <DeploymentsTab onRetry={handleRetryDeployment} />}
        </Box>
      </Card>

      <DeployWizard
        open={wizardOpen}
        onClose={handleWizardClose}
        image={selectedImage}
        prefillBlueprint={selectedBlueprint}
        resumeDeploymentId={resumeDeploymentId}
      />
    </Box>
  )
}
