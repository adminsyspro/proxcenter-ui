'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Box, Card, Tab, Tabs } from '@mui/material'

import { usePageTitle } from '@/contexts/PageTitleContext'
import type { CloudImage } from '@/lib/templates/cloudImages'
import { ImageCatalogTab, BlueprintsTab, DeploymentsTab, DeployWizard } from '@/components/templates'
import { TableSkeleton } from '@/components/skeletons'
import { getImageBySlug } from '@/lib/templates/cloudImages'

export default function TemplatesPage() {
  const t = useTranslations()
  const { setPageInfo } = usePageTitle()
  const [mounted, setMounted] = useState(false)
  const [tab, setTab] = useState(0)

  // Deploy wizard state
  const [wizardOpen, setWizardOpen] = useState(false)
  const [selectedImage, setSelectedImage] = useState<CloudImage | null>(null)
  const [selectedBlueprint, setSelectedBlueprint] = useState<any | null>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    setPageInfo(t('templates.title'), t('templates.catalogSubtitle'), 'ri-cloud-line')
    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  const handleDeployImage = useCallback((image: CloudImage) => {
    setSelectedImage(image)
    setSelectedBlueprint(null)
    setWizardOpen(true)
  }, [])

  const handleDeployBlueprint = useCallback((blueprint: any) => {
    const image = getImageBySlug(blueprint.imageSlug)
    setSelectedImage(image || null)
    setSelectedBlueprint(blueprint)
    setWizardOpen(true)
  }, [])

  const handleWizardClose = useCallback(() => {
    setWizardOpen(false)
    setSelectedImage(null)
    setSelectedBlueprint(null)
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
          {tab === 2 && <DeploymentsTab />}
        </Box>
      </Card>

      <DeployWizard
        open={wizardOpen}
        onClose={handleWizardClose}
        image={selectedImage}
        prefillBlueprint={selectedBlueprint}
      />
    </Box>
  )
}
