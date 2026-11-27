'use client'
import { useMemo } from 'react'
import { Box, Chip, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'
import type { K8sTopologyData, K8sResourceKind } from '@/lib/k8s/topologyTypes'

export type K8sTopologyViewMode = 'apps' | 'nodes'

// Kinds that only exist in the topology view (not in the explorer kind namespace)
const TOPOLOGY_ONLY_KINDS = new Set<K8sResourceKind>(['podGroup', 'replicaset'])

// Map from singular kind to plural perKind key for capped-flag lookup
const KIND_TO_PLURAL: Partial<Record<K8sResourceKind, string>> = {
  pod: 'pods',
  service: 'services',
  ingress: 'ingresses',
  deployment: 'deployments',
  statefulset: 'statefulsets',
  daemonset: 'daemonsets',
  job: 'jobs',
  cronjob: 'cronjobs',
  replicaset: 'replicasets',
  configmap: 'configmaps',
}

interface K8sTopologyToolbarProps {
  data: K8sTopologyData
  namespace: string
  enabledKinds: Set<K8sResourceKind>
  onToggleKind: (kind: K8sResourceKind) => void
  mode: K8sTopologyViewMode
  onModeChange: (mode: K8sTopologyViewMode) => void
  showKindFilters?: boolean
}

export function K8sTopologyToolbar({
  data,
  namespace,
  enabledKinds,
  onToggleKind,
  mode,
  onModeChange,
  showKindFilters = false,
}: K8sTopologyToolbarProps) {
  const t = useTranslations('kubernetes.topology')
  const tKind = useTranslations('kubernetes.explorer.kind')

  // Derive chips from singular kinds actually present in data.resources
  const kindEntries = useMemo(() => {
    const counts = new Map<K8sResourceKind, number>()
    for (const r of data.resources) {
      counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1)
    }
    return Array.from(counts.entries())
  }, [data.resources])

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 1,
        px: 1.5,
        py: 1,
        borderBottom: 1,
        borderColor: 'divider',
        flexShrink: 0,
      }}
    >
      {/* Apps / Nodes mode toggle */}
      <ToggleButtonGroup
        value={mode}
        exclusive
        size="small"
        onChange={(_evt, next: K8sTopologyViewMode | null) => {
          if (next) onModeChange(next)
        }}
        sx={{ flexShrink: 0 }}
      >
        <ToggleButton value="apps" sx={{ fontSize: '0.75rem', py: 0.25, px: 1.25 }}>
          {t('apps.tab')}
        </ToggleButton>
        <ToggleButton value="nodes" sx={{ fontSize: '0.75rem', py: 0.25, px: 1.25 }}>
          {t('nodes.tab')}
        </ToggleButton>
      </ToggleButtonGroup>

      {/* Kind filter chips - clickable toggles, only shown while an app graph is open */}
      {showKindFilters && kindEntries.map(([kind, count]) => {
        const isEnabled = enabledKinds.has(kind)
        let kindLabel: string
        if (TOPOLOGY_ONLY_KINDS.has(kind)) {
          // Use topology namespace for kinds not present in the explorer
          kindLabel = t(`kind${kind.charAt(0).toUpperCase()}${kind.slice(1)}` as any)
        } else {
          try {
            kindLabel = tKind(kind as any)
          } catch {
            kindLabel = kind
          }
        }
        const pluralKey = KIND_TO_PLURAL[kind]
        const isCapped = pluralKey ? (data.meta.perKind[pluralKey]?.capped ?? false) : false
        const label = `${kindLabel} (${count}${isCapped ? '+' : ''})`
        return (
          <Chip
            key={kind}
            label={label}
            size="small"
            variant={isEnabled ? 'filled' : 'outlined'}
            onClick={() => onToggleKind(kind)}
            sx={{
              fontSize: '0.7rem',
              height: 22,
              cursor: 'pointer',
              opacity: isEnabled ? 1 : 0.45,
            }}
          />
        )
      })}

      <Box sx={{ flex: 1 }} />

      {/* Namespace read-only label (editable picker is in the explorer header) */}
      {namespace && (
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          {t('toolbar.namespace')}: {namespace}
        </Typography>
      )}
    </Box>
  )
}
