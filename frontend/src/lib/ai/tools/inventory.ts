/**
 * Snapshot-only inventory tools.
 *
 * These answer from the already-collected `AiSnapshot` and never touch
 * Proxmox, which makes them the cheap path for the listing questions. The
 * prompt caps the stopped-guest list it inlines and points the model here for
 * the rest.
 */

import {
  argEnum,
  argNumber,
  argString,
  resolveConnection,
  type AiTool,
} from '@/lib/ai/tools/types'

export const listGuestsTool: AiTool = {
  name: 'list_guests',
  description:
    'List the VMs and containers visible to the user, with optional filters. Use it when the user asks for a full list that the snapshot truncated, or for the guests of one host, pool or tag. Example: status=\'stopped\', limit=100',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Filter on run state.',
        enum: ['all', 'running', 'stopped'],
        default: 'all',
      },
      cluster: { type: 'string', description: 'Restrict to one cluster, by name.' },
      node: { type: 'string', description: 'Restrict to one host, by name.' },
      pool: { type: 'string', description: 'Restrict to one Proxmox pool.' },
      tag: { type: 'string', description: 'Restrict to guests carrying this tag.' },
      limit: { type: 'integer', description: 'Maximum guests to return.', default: 100 },
    },
  },
  async execute(args, ctx) {
    const status = argEnum(args, 'status', ['all', 'running', 'stopped'] as const, 'all')
    const limit = argNumber(args, 'limit', 100, { min: 1, max: 500 })
    const clusterRef = argString(args, 'cluster')
    const nodeRef = argString(args, 'node')?.toLowerCase()
    const poolRef = argString(args, 'pool')?.toLowerCase()
    const tagRef = argString(args, 'tag')?.toLowerCase()

    const connId = clusterRef ? resolveConnection(ctx, clusterRef).id : undefined

    let guests = ctx.snapshot.guests

    if (connId) guests = guests.filter(g => g.connId === connId)
    if (status === 'running') guests = guests.filter(g => g.status === 'running')
    if (status === 'stopped') guests = guests.filter(g => g.status !== 'running')
    if (nodeRef) guests = guests.filter(g => g.node.toLowerCase() === nodeRef)
    if (poolRef) guests = guests.filter(g => (g.pool || '').toLowerCase() === poolRef)

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
      })),
    }
  },
}

export const listHostsTool: AiTool = {
  name: 'list_hosts',
  description:
    'List the Proxmox hosts visible to the user with their live CPU and RAM usage, core count and cluster. Use it to know which host names exist before asking for one host\'s hardware. Example: cluster=\'production\'',
  parameters: {
    type: 'object',
    properties: {
      cluster: { type: 'string', description: 'Restrict to one cluster, by name.' },
    },
  },
  async execute(args, ctx) {
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
      })),
    }
  },
}
