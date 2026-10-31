/**
 * Snapshot-only inventory tools.
 *
 * These answer from the already-collected `InventorySnapshot` and never touch
 * Proxmox, which makes them the cheap path for the listing questions. The
 * prompt caps the stopped-guest list it inlines and points the model here for
 * the rest.
 */

import {
  argEnum,
  argNumber,
  argString,
  resolveConnection,
  syncExecute,
  type CatalogTool,
} from '@/lib/tools/types'

/** Whole days, null when unknown: what an answer about uptime needs. */
const days = (seconds?: number) => (seconds ? Math.floor(seconds / 86_400) : null)

export const listGuestsTool: CatalogTool = {
  name: 'list_guests',
  readOnly: true,
  description:
    'List the VMs and containers visible to the user, with optional filters, their uptime and HA state. Use it when the user asks for a full list that the snapshot truncated, for the guests of one host, pool or tag, or "which VMs are not protected by HA". Example: status=\'stopped\', limit=100 or ha=\'unmanaged\', status=\'running\'',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Filter on run state.',
        enum: ['all', 'running', 'stopped'],
        default: 'all',
      },
      cluster: { type: 'string', description: 'Cluster name, only when the user names one. Omit it to list every visible cluster.' },
      node: { type: 'string', description: 'Restrict to one host, by name.' },
      pool: { type: 'string', description: 'Restrict to one Proxmox pool.' },
      tag: { type: 'string', description: 'Restrict to guests carrying this tag.' },
      ha: {
        type: 'string',
        description: 'managed: only guests under Proxmox HA; unmanaged: only guests HA does not protect.',
        enum: ['all', 'managed', 'unmanaged'],
        default: 'all',
      },
      limit: { type: 'integer', description: 'Maximum guests to return.', default: 100 },
    },
  },
  execute: syncExecute((args, ctx) => {
    const status = argEnum(args, 'status', ['all', 'running', 'stopped'] as const, 'all')
    const limit = argNumber(args, 'limit', 100, { min: 1, max: 500 })
    const clusterRef = argString(args, 'cluster')
    const nodeRef = argString(args, 'node')?.toLowerCase()
    const poolRef = argString(args, 'pool')?.toLowerCase()
    const tagRef = argString(args, 'tag')?.toLowerCase()
    const ha = argEnum(args, 'ha', ['all', 'managed', 'unmanaged'] as const, 'all')

    const connId = clusterRef ? resolveConnection(ctx, clusterRef).id : undefined

    let guests = ctx.snapshot.guests

    if (connId) guests = guests.filter(g => g.connId === connId)
    if (status === 'running') guests = guests.filter(g => g.status === 'running')
    if (status === 'stopped') guests = guests.filter(g => g.status !== 'running')
    if (nodeRef) guests = guests.filter(g => g.node.toLowerCase() === nodeRef)
    if (poolRef) guests = guests.filter(g => (g.pool || '').toLowerCase() === poolRef)
    if (ha === 'managed') guests = guests.filter(g => g.haState)
    if (ha === 'unmanaged') guests = guests.filter(g => !g.haState)

    if (tagRef) {
      guests = guests.filter(g =>
        (g.tags || '')
          .split(/[;,]/)
          .map(t => t.trim().toLowerCase())
          .includes(tagRef)
      )
    }

    const total = guests.length
    const shown = guests.slice(0, limit)

    return {
      total,
      returned: shown.length,
      truncated: total > shown.length,
      guests: shown.map(g => ({
        name: g.name,
        vmid: g.vmid,
        type: g.type,
        status: g.status,
        node: g.node,
        cluster: g.cluster,
        vcpus: g.vcpus,
        memoryGb: g.memTotalGb,
        pool: g.pool,
        tags: g.tags,
        template: g.template,
        uptimeDays: days(g.uptimeSeconds),
        haState: g.haState ?? null,
      })),
    }
  }),
}

export const listHostsTool: CatalogTool = {
  name: 'list_hosts',
  readOnly: true,
  description:
    'List the Proxmox hosts visible to the user with their live CPU and RAM usage, core count, cluster, uptime, Proxmox VE and kernel versions, load, I/O wait, swap and root filesystem usage. Answers "are all hosts on the same Proxmox version?", "which host has not rebooted for months?", "is any host swapping?". Use it to know which host names exist before asking for one host\'s hardware. Example: cluster=\'production\'',
  parameters: {
    type: 'object',
    properties: {
      cluster: { type: 'string', description: 'Cluster name, only when the user names one. Omit it to list every visible cluster.' },
    },
  },
  execute: syncExecute((args, ctx) => {
    const clusterRef = argString(args, 'cluster')
    const connId = clusterRef ? resolveConnection(ctx, clusterRef).id : undefined
    const nodes = connId ? ctx.snapshot.nodes.filter(n => n.connId === connId) : ctx.snapshot.nodes

    return {
      total: nodes.length,
      clusters: ctx.snapshot.clusters.map(c => ({
        name: c.name,
        hosts: c.nodeCount,
        guests: c.guestCount,
        cephHealth: c.cephHealth ?? null,
      })),
      hosts: nodes.map(n => ({
        name: n.name,
        cluster: n.cluster,
        status: n.status,
        cores: n.cores,
        cpuPct: n.cpuPct,
        memoryUsedGb: n.memUsedGb,
        memoryTotalGb: n.memTotalGb,
        memoryPct: n.memPct,
        maintenance: n.maintenance ?? null,
        uptimeDays: days(n.uptimeSeconds),
        pveVersion: n.pveVersion ?? null,
        kernel: n.kernel ?? null,
        load1: n.load1 ?? null,
        iowaitPct: n.iowaitPct ?? null,
        swapUsedGb: n.swapUsedGb ?? null,
        swapTotalGb: n.swapTotalGb ?? null,
        rootfsUsedPct: n.rootfsPct ?? null,
      })),
    }
  }),
}
