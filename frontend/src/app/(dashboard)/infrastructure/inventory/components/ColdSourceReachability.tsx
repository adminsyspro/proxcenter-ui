'use client'

import { useTranslations } from 'next-intl'
import { Alert, CircularProgress, Typography } from '@mui/material'

/**
 * Cold vCenter migration: can the target node reach the address the source
 * disks are downloaded from (lib/migration/cold-source-reach)? The download
 * runs on the Proxmox node, from the URL of the vCenter export lease, which is
 * neither ProxCenter's route nor necessarily the vCenter's 443. Values only
 * come from the server, the sentences are composed from the catalogue.
 */

export type ColdEndpoint = { host: string; port: number; resolved: boolean; open: boolean }

/** Answer of the preflight route's cold-source-check action. */
export type ColdSourceReach =
  | { status: 'ok'; node: string; endpoints: ColdEndpoint[] }
  | { status: 'blocked'; node: string; endpoints: ColdEndpoint[] }
  | { status: 'skipped'; reason: 'poweredOn' | 'notVcenter' }
  | { status: 'error'; node: string; error: string }

/** Single VM dialog state: the answer, or the check in flight. */
export type ColdSourceReachState = { key: string; loading: boolean; reach: ColdSourceReach | null }

/** Answer of POST /api/v1/migrations/batches/cold-source-check. */
export type ColdBatchReach = {
  problems: Array<{ node: string; endpoints: ColdEndpoint[]; vms: string[] }>
  unchecked: string[]
  errors: Array<{ node: string; error: string }>
}

export type ColdBatchReachState = { status: 'idle' } | { status: 'checking' } | { status: 'done'; reach: ColdBatchReach }

/** The single VM launch waits for a current verdict and stops on a blocked one; an error never blocks. */
export function coldSourceBlocksLaunch(state: ColdSourceReachState | null): boolean {
  if (!state) return false
  if (state.loading) return true
  return state.reach?.status === 'blocked'
}

/**
 * Bulk dialog state from the request key and the last answer kept with its
 * key: no request is idle, a request without its answer is in flight, an
 * answer the dialog could not read blocks nothing (each job probes again).
 */
export function bulkColdState(key: string | null, result: { key: string; reach: ColdBatchReach | null } | null): ColdBatchReachState {
  if (!key) return { status: 'idle' }
  if (!result || result.key !== key) return { status: 'checking' }
  return result.reach ? { status: 'done', reach: result.reach } : { status: 'idle' }
}

export function coldBatchBlocksLaunch(state: ColdBatchReachState): boolean {
  return state.status === 'checking' || (state.status === 'done' && state.reach.problems.length > 0)
}

/**
 * Warm copy probe of a vCenter source where the node reaches the vCenter on
 * 443 but not the host's adapter on 902: the shape of a hosted vCenter whose
 * ESXi hosts are not reachable from outside. The offline path downloads
 * through the address the vCenter's export names instead.
 */
export function hostedCloudShape(c: { error?: string; ports: Record<string, boolean>; vcenter?: { resolved: boolean; open: boolean } } | null | undefined): boolean {
  if (!c || c.error || !c.vcenter) return false
  return c.vcenter.resolved && c.vcenter.open && c.ports['902'] === false
}

type T = ReturnType<typeof useTranslations>

/** "10.42.0.22:443, vc-proxy.example:8443 (name not resolved on the node)". */
export function formatColdEndpoints(t: T, endpoints: ColdEndpoint[], onlyDown: boolean): string {
  return endpoints
    .filter(e => !onlyDown || !e.resolved || !e.open)
    .map(e => (e.resolved ? `${e.host}:${e.port}` : t('inventoryPage.esxiMigration.coldSourceUnresolved', { host: e.host })))
    .join(', ')
}

/** Verdict of the single VM dialog, under the virt-v2v readiness of the node. */
export function ColdSourceReachAlert({ state, node }: { state: ColdSourceReachState | null; node: string }) {
  const t = useTranslations()

  if (!state) return null
  if (state.loading) {
    return (
      <Alert severity="info" icon={<CircularProgress size={16} />} sx={{ fontSize: 12 }} data-testid="mig-cold-source-checking">
        {t('inventoryPage.esxiMigration.coldSourceChecking', { node })}
      </Alert>
    )
  }
  const reach = state.reach
  if (!reach || reach.status === 'skipped') return null
  if (reach.status === 'ok') {
    return (
      <Alert severity="success" sx={{ fontSize: 12 }} data-testid="mig-cold-source-ok">
        {t('inventoryPage.esxiMigration.coldSourceOk', { node: reach.node, endpoints: formatColdEndpoints(t, reach.endpoints, false) })}
      </Alert>
    )
  }
  if (reach.status === 'blocked') {
    return (
      <Alert severity="error" sx={{ fontSize: 12 }} data-testid="mig-cold-source-blocked">
        {t('inventoryPage.esxiMigration.coldSourceBlocked', { node: reach.node, endpoints: formatColdEndpoints(t, reach.endpoints, true) })}
      </Alert>
    )
  }
  return (
    <Alert severity="warning" sx={{ fontSize: 12 }} data-testid="mig-cold-source-error">
      {t('inventoryPage.esxiMigration.coldSourceError', { node: reach.node, error: reach.error })}
    </Alert>
  )
}

/** Verdict of the bulk dialog: one line per node and unreachable address, advisory errors apart. */
export function ColdBatchReachAlert({ state }: { state: ColdBatchReachState }) {
  const t = useTranslations()

  if (state.status === 'idle') return null
  if (state.status === 'checking') {
    return (
      <Alert severity="info" icon={<CircularProgress size={16} />} data-testid="bulk-cold-source-checking">
        {t('inventoryPage.esxiMigration.coldSourceBatchChecking')}
      </Alert>
    )
  }
  const { problems, errors } = state.reach
  return (
    <>
      {problems.length > 0 && (
        <Alert severity="error" data-testid="bulk-cold-source-error">
          {problems.map((p, i) => (
            <Typography key={i} variant="body2">
              {t('inventoryPage.esxiMigration.coldSourceBatchBlocked', { node: p.node, endpoints: formatColdEndpoints(t, p.endpoints, true), vms: p.vms.join(', ') })}
            </Typography>
          ))}
        </Alert>
      )}
      {errors.length > 0 && (
        <Alert severity="warning" data-testid="bulk-cold-source-warning">
          {errors.map((e, i) => (
            <Typography key={i} variant="body2">{t('inventoryPage.esxiMigration.coldSourceError', { node: e.node, error: e.error })}</Typography>
          ))}
        </Alert>
      )}
    </>
  )
}
