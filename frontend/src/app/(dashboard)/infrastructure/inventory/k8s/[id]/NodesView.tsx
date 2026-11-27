'use client'
import { Box, Card, CardActionArea, Chip, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useTranslations } from 'next-intl'
import type { DetailRef, K8sTopologyData, K8sTopologyK8sNode } from '@/lib/k8s/topologyTypes'
import { isExternalToProxmox } from '@/lib/k8s/appGrid'
import { K8sTopologyCanvas } from './K8sTopologyCanvas'

interface NodesViewProps {
  data: K8sTopologyData
  onDetailRef: (ref: DetailRef, kind: string) => void
}

function ExternalNodeCard({ node, onDetailRef }: { node: K8sTopologyK8sNode; onDetailRef: (ref: DetailRef, kind: string) => void }) {
  const t = useTranslations('kubernetes.topology')
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const readyColor = node.ready ? '#4caf50' : '#f44336'

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 'var(--proxcenter-card-radius, 12px)',
        borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
      }}
    >
      <CardActionArea
        onClick={() => onDetailRef(node.detailRef, 'node')}
        sx={{ p: 1.5, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0.5 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, width: '100%' }}>
          <img
            src="/images/kubernetes-logo.svg"
            alt=""
            width={16}
            height={16}
            style={{ flexShrink: 0, opacity: 0.9 }}
          />
          <Box
            role="status"
            aria-label={t(node.ready ? 'card.ready' : 'node.unmapped')}
            sx={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', bgcolor: readyColor, flexShrink: 0 }}
          />
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {node.name}
          </Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
          {[node.version, node.internalIP].filter(Boolean).join(' · ')}
        </Typography>
      </CardActionArea>
    </Card>
  )
}

export function NodesView({ data, onDetailRef }: NodesViewProps) {
  const t = useTranslations('kubernetes.topology')

  if (data.infra.bridgeStatus !== 'enabled') {
    const external = isExternalToProxmox(data)
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {external && (
          <Box sx={{ p: 2, pb: 0 }}>
            <Chip label={t('apps.external')} size="small" variant="outlined" />
          </Box>
        )}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 2, p: 2, overflowY: 'auto' }}>
          {data.infra.k8sNodes.map((node) => (
            <ExternalNodeCard key={node.uid} node={node} onDetailRef={onDetailRef} />
          ))}
        </Box>
      </Box>
    )
  }

  const canvasData: K8sTopologyData = {
    ...data,
    resources: [],
    edges: [],
  }

  return (
    <Box sx={{ height: '100%', minHeight: 0 }}>
      <K8sTopologyCanvas data={canvasData} onDetailRef={onDetailRef} />
    </Box>
  )
}
