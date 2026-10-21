/**
 * Tool-calling bench for the AI assistant (#459).
 *
 * Replays the exact prompt and request body the chat route sends to Ollama,
 * with the real tool definitions, against every model of a running Ollama,
 * and scores each of the reporter's questions on two things: did the model
 * call the right tool first, and did its final answer carry the figure that
 * tool returned. Tool execution is stubbed with canned data so the run needs
 * no Proxmox and every model sees the same numbers.
 *
 *   npx tsx scripts/ai-tool-bench.ts [--url http://localhost:11434]
 *        [--models a,b,c] [--lang en|fr] [--num-ctx 8192] [--first-only]
 *        [--runs 1] [--out results.json] [--dry]
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { renderAiSystemPrompt, type AiAlert } from '@/lib/ai/context'
import type { SnapshotGuest, SnapshotNode, InventorySnapshot } from '@/lib/tools/snapshot'
import { languageInstruction } from '@/lib/ai/locale'
import { ollamaOptions } from '@/lib/ai/ollama'
import { READ_ONLY_TOOLS } from '@/lib/tools/catalog'
import { extractTextToolCall, parseAssistantText, parseToolCalls, toolsForProvider } from '@/lib/ai/tools/adapters'
import { runToolRounds, type ToolMode } from '@/lib/ai/tools/loop'
import { ToolArgumentError, type CatalogTool, type ToolContext } from '@/lib/tools/types'

/* ------------------------------------------------------------------ */
/* CLI                                                                */
/* ------------------------------------------------------------------ */

function flag(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)

  if (i === -1) return fallback
  const v = process.argv[i + 1]

  return v && !v.startsWith('--') ? v : 'true'
}

const OLLAMA = (flag('url', 'http://localhost:11434') as string).replace(/\/$/, '')
const LANG = flag('lang', 'en') === 'fr' ? 'fr' : 'en'
const LOCALE = LANG
// Default: whatever the route sends (ollamaOptions). `--num-ctx 4096` replays the old default.
const NUM_CTX = flag('num-ctx') ? Number(flag('num-ctx')) : undefined
const VARIANTS = flag('variants') === 'true'
// Repeats one question at several num_ctx values and splits prompt evaluation from generation time.
const LATENCY_PROBE = flag('latency-probe') === 'true'
const FIRST_ONLY = flag('first-only') === 'true'
const RUNS = Number(flag('runs', '1'))
const DRY = flag('dry') === 'true'
// Ollama >= 0.9: `think: false` turns the reasoning trace off for qwen3 and the like.
const NO_THINK = flag('no-think') === 'true'
const OUT = flag('out', `/root/saas/proxcenter-frontend/.superpowers/sdd/459-ai-tools/bench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`) as string

/* ------------------------------------------------------------------ */
/* Fixture: a mid-size estate, two clusters, Ceph on the first        */
/* ------------------------------------------------------------------ */

const PROD = 'conn-prod'
const LAB = 'conn-lab'

function g(o: Partial<SnapshotGuest> & { name: string; vmid: string; node: string }): SnapshotGuest {
  const connId = o.node.startsWith('lab') ? LAB : PROD

  return {
    connId,
    cluster: connId === PROD ? 'prod' : 'lab',
    type: 'VM',
    kind: 'qemu',
    status: 'running',
    cpuPct: 3,
    memPct: 35,
    memUsedGb: 1.4,
    memTotalGb: 4,
    template: false,
    ...o,
  }
}

const guests: SnapshotGuest[] = [
  // The snapshot's CPU/RAM leaders. None of them is the answer to a hardware
  // question, so a model answering from the snapshot is visibly wrong.
  g({ name: 'db-01', vmid: '101', node: 'pve1', cpuPct: 81.2, memPct: 88.5, memUsedGb: 28.3, memTotalGb: 32, vcpus: 8, diskTotalGb: 200 }),
  g({ name: 'web-01', vmid: '102', node: 'pve1', cpuPct: 44.7, memPct: 61.0, memUsedGb: 4.9, memTotalGb: 8, vcpus: 4, diskTotalGb: 40 }),
  g({ name: 'web-02', vmid: '103', node: 'pve2', cpuPct: 39.1, memPct: 58.2, memUsedGb: 4.7, memTotalGb: 8, vcpus: 4, diskTotalGb: 40 }),
  g({ name: 'elastic-01', vmid: '110', node: 'pve2', cpuPct: 36.0, memPct: 79.4, memUsedGb: 12.7, memTotalGb: 16, vcpus: 6, diskTotalGb: 500 }),
  g({ name: 'redis-01', vmid: '111', node: 'pve3', cpuPct: 22.5, memPct: 41.0, memUsedGb: 1.6, memTotalGb: 4, vcpus: 2, diskTotalGb: 20 }),
  g({ name: 'k8s-worker-01', vmid: '120', node: 'pve1', cpuPct: 31.3, memPct: 66.2, memUsedGb: 10.6, memTotalGb: 16, vcpus: 8, diskTotalGb: 100 }),
  g({ name: 'k8s-worker-02', vmid: '121', node: 'pve2', cpuPct: 28.8, memPct: 63.9, memUsedGb: 10.2, memTotalGb: 16, vcpus: 8, diskTotalGb: 100 }),
  g({ name: 'k8s-worker-03', vmid: '122', node: 'pve3', cpuPct: 30.1, memPct: 65.5, memUsedGb: 10.5, memTotalGb: 16, vcpus: 8, diskTotalGb: 100 }),
  g({ name: 'k8s-master-01', vmid: '123', node: 'pve1', cpuPct: 12.0, memPct: 52.0, memUsedGb: 4.2, memTotalGb: 8, vcpus: 4, diskTotalGb: 60 }),
  g({ name: 'mail-01', vmid: '130', node: 'pve3', cpuPct: 9.4, memPct: 47.3, memUsedGb: 3.8, memTotalGb: 8, vcpus: 4, diskTotalGb: 300 }),
  g({ name: 'gitlab-01', vmid: '131', node: 'pve2', cpuPct: 18.7, memPct: 72.1, memUsedGb: 11.5, memTotalGb: 16, vcpus: 8, diskTotalGb: 400 }),
  g({ name: 'monitoring-01', vmid: '132', node: 'pve1', cpuPct: 15.2, memPct: 55.0, memUsedGb: 4.4, memTotalGb: 8, vcpus: 4, diskTotalGb: 250 }),
  g({ name: 'dns-01', vmid: '140', node: 'pve1', type: 'CT', kind: 'lxc', cpuPct: 0.8, memPct: 20.1, memUsedGb: 0.2, memTotalGb: 1, vcpus: 1, diskTotalGb: 8 }),
  g({ name: 'dns-02', vmid: '141', node: 'pve2', type: 'CT', kind: 'lxc', cpuPct: 0.7, memPct: 19.8, memUsedGb: 0.2, memTotalGb: 1, vcpus: 1, diskTotalGb: 8 }),
  g({ name: 'proxy-01', vmid: '142', node: 'pve3', type: 'CT', kind: 'lxc', cpuPct: 2.1, memPct: 30.0, memUsedGb: 0.6, memTotalGb: 2, vcpus: 2, diskTotalGb: 8 }),
  // The hardware leaders, quiet in the snapshot: most vCPUs, most RAM, biggest disk.
  g({ name: 'build-runner-03', vmid: '214', node: 'pve2', cpuPct: 1.9, memPct: 12.0, memUsedGb: 1.9, memTotalGb: 16, vcpus: 16, diskTotalGb: 120 }),
  g({ name: 'sap-hana-01', vmid: '220', node: 'pve3', cpuPct: 4.2, memPct: 23.0, memUsedGb: 29.4, memTotalGb: 128, vcpus: 12, diskTotalGb: 500 }),
  g({ name: 'backup-proxy-01', vmid: '230', node: 'pve1', cpuPct: 2.6, memPct: 40.0, memUsedGb: 3.2, memTotalGb: 8, vcpus: 4, diskTotalGb: 2048 }),
  g({ name: 'fileserver-01', vmid: '231', node: 'pve2', cpuPct: 3.0, memPct: 38.0, memUsedGb: 3.0, memTotalGb: 8, vcpus: 4, diskTotalGb: 1024 }),
  g({ name: 'ad-dc-01', vmid: '240', node: 'pve1', cpuPct: 1.5, memPct: 45.0, memUsedGb: 1.8, memTotalGb: 4, vcpus: 2, diskTotalGb: 80 }),
  g({ name: 'ad-dc-02', vmid: '241', node: 'pve3', cpuPct: 1.4, memPct: 44.0, memUsedGb: 1.8, memTotalGb: 4, vcpus: 2, diskTotalGb: 80 }),
  g({ name: 'jump-01', vmid: '250', node: 'pve2', cpuPct: 0.5, memPct: 25.0, memUsedGb: 0.5, memTotalGb: 2, vcpus: 1, diskTotalGb: 32 }),
  g({ name: 'wiki-01', vmid: '251', node: 'pve1', type: 'CT', kind: 'lxc', cpuPct: 1.1, memPct: 33.0, memUsedGb: 0.7, memTotalGb: 2, vcpus: 2, diskTotalGb: 16 }),
  g({ name: 'lab-ubuntu-01', vmid: '301', node: 'lab1', cpuPct: 5.0, memPct: 30.0, memUsedGb: 1.2, memTotalGb: 4, vcpus: 2, diskTotalGb: 32 }),
  g({ name: 'lab-ubuntu-02', vmid: '302', node: 'lab1', cpuPct: 6.1, memPct: 31.0, memUsedGb: 1.2, memTotalGb: 4, vcpus: 2, diskTotalGb: 32 }),
  g({ name: 'lab-win11-01', vmid: '303', node: 'lab2', cpuPct: 11.0, memPct: 60.0, memUsedGb: 4.8, memTotalGb: 8, vcpus: 4, diskTotalGb: 80 }),
  g({ name: 'lab-k3s-01', vmid: '304', node: 'lab2', cpuPct: 8.3, memPct: 50.0, memUsedGb: 2.0, memTotalGb: 4, vcpus: 2, diskTotalGb: 40 }),
  g({ name: 'lab-pfsense', vmid: '305', node: 'lab1', cpuPct: 2.0, memPct: 22.0, memUsedGb: 0.4, memTotalGb: 2, vcpus: 2, diskTotalGb: 16 }),
  // Stopped.
  g({ name: 'old-erp-01', vmid: '150', node: 'pve1', status: 'stopped', cpuPct: 0, memPct: 0, memUsedGb: 0, memTotalGb: 16, vcpus: 4, diskTotalGb: 300 }),
  g({ name: 'test-upgrade-01', vmid: '151', node: 'pve2', status: 'stopped', cpuPct: 0, memPct: 0, memUsedGb: 0, memTotalGb: 8, vcpus: 4, diskTotalGb: 60 }),
  g({ name: 'win2016-legacy', vmid: '152', node: 'pve3', status: 'stopped', cpuPct: 0, memPct: 0, memUsedGb: 0, memTotalGb: 8, vcpus: 2, diskTotalGb: 120 }),
  g({ name: 'db-02-standby', vmid: '153', node: 'pve2', status: 'stopped', cpuPct: 0, memPct: 0, memUsedGb: 0, memTotalGb: 32, vcpus: 8, diskTotalGb: 200 }),
  g({ name: 'staging-web', vmid: '154', node: 'pve1', status: 'stopped', cpuPct: 0, memPct: 0, memUsedGb: 0, memTotalGb: 4, vcpus: 2, diskTotalGb: 40 }),
  g({ name: 'staging-api', vmid: '155', node: 'pve3', status: 'stopped', cpuPct: 0, memPct: 0, memUsedGb: 0, memTotalGb: 4, vcpus: 2, diskTotalGb: 40 }),
  g({ name: 'lab-centos7', vmid: '310', node: 'lab1', status: 'stopped', cpuPct: 0, memPct: 0, memUsedGb: 0, memTotalGb: 2, vcpus: 1, diskTotalGb: 20 }),
  g({ name: 'lab-debian12-tpl', vmid: '900', node: 'lab2', status: 'stopped', template: true, cpuPct: 0, memPct: 0, memUsedGb: 0, memTotalGb: 2, vcpus: 1, diskTotalGb: 10 }),
  g({ name: 'ubuntu-2404-tpl', vmid: '901', node: 'pve1', status: 'stopped', template: true, cpuPct: 0, memPct: 0, memUsedGb: 0, memTotalGb: 2, vcpus: 2, diskTotalGb: 10 }),
  g({ name: 'lab-scratch-01', vmid: '311', node: 'lab2', status: 'stopped', cpuPct: 0, memPct: 0, memUsedGb: 0, memTotalGb: 4, vcpus: 2, diskTotalGb: 32 }),
  g({ name: 'lab-scratch-02', vmid: '312', node: 'lab2', status: 'stopped', cpuPct: 0, memPct: 0, memUsedGb: 0, memTotalGb: 4, vcpus: 2, diskTotalGb: 32 }),
  g({ name: 'vpn-old', vmid: '156', node: 'pve2', status: 'stopped', cpuPct: 0, memPct: 0, memUsedGb: 0, memTotalGb: 1, vcpus: 1, diskTotalGb: 8 }),
]

const nodes: SnapshotNode[] = [
  { connId: PROD, cluster: 'prod', name: 'pve1', status: 'online', cpuPct: 34.2, cores: 48, memPct: 71.5, memUsedGb: 183, memTotalGb: 256 },
  { connId: PROD, cluster: 'prod', name: 'pve2', status: 'online', cpuPct: 41.8, cores: 48, memPct: 68.0, memUsedGb: 174, memTotalGb: 256 },
  { connId: PROD, cluster: 'prod', name: 'pve3', status: 'online', cpuPct: 27.6, cores: 32, memPct: 80.9, memUsedGb: 155, memTotalGb: 192 },
  { connId: LAB, cluster: 'lab', name: 'lab1', status: 'online', cpuPct: 9.1, cores: 16, memPct: 38.0, memUsedGb: 24, memTotalGb: 64 },
  { connId: LAB, cluster: 'lab', name: 'lab2', status: 'online', cpuPct: 14.4, cores: 16, memPct: 55.2, memUsedGb: 35, memTotalGb: 64 },
]

const running = guests.filter(x => x.status === 'running').length

const snapshot: InventorySnapshot = {
  clusters: [
    { id: PROD, name: 'prod', nodeCount: 3, guestCount: guests.filter(x => x.connId === PROD).length, cephHealth: 'HEALTH_WARN' },
    { id: LAB, name: 'lab', nodeCount: 2, guestCount: guests.filter(x => x.connId === LAB).length },
  ],
  nodes,
  guests,
  summary: { totalGuests: guests.length, runningGuests: running, stoppedGuests: guests.length - running, totalNodes: 5, onlineNodes: 5 },
  cached: false,
}

const alerts: AiAlert[] = [
  { severity: 'warning', message: 'Ceph health is HEALTH_WARN', entityName: 'prod', entityType: 'cluster' },
  { severity: 'warning', message: 'Memory usage above 80%', entityName: 'pve3', entityType: 'node', metric: 'memory', currentValue: 80.9, threshold: 80 },
]

/* ------------------------------------------------------------------ */
/* Canned tool results, same field names as the real tools            */
/* ------------------------------------------------------------------ */

const RANKINGS: Record<string, any[]> = {
  vcpus: [
    { rank: 1, name: 'build-runner-03', vmid: '214', type: 'VM', node: 'pve2', cluster: 'prod', vcpus: 16, memoryGb: 16, diskGb: 120 },
    { rank: 2, name: 'sap-hana-01', vmid: '220', type: 'VM', node: 'pve3', cluster: 'prod', vcpus: 12, memoryGb: 128, diskGb: 500 },
    { rank: 3, name: 'db-01', vmid: '101', type: 'VM', node: 'pve1', cluster: 'prod', vcpus: 8, memoryGb: 32, diskGb: 200 },
  ],
  memory: [
    { rank: 1, name: 'sap-hana-01', vmid: '220', type: 'VM', node: 'pve3', cluster: 'prod', vcpus: 12, memoryGb: 128, diskGb: 500 },
    { rank: 2, name: 'db-01', vmid: '101', type: 'VM', node: 'pve1', cluster: 'prod', vcpus: 8, memoryGb: 32, diskGb: 200 },
    { rank: 3, name: 'db-02-standby', vmid: '153', type: 'VM', node: 'pve2', cluster: 'prod', vcpus: 8, memoryGb: 32, diskGb: 200 },
  ],
  disk: [
    { rank: 1, name: 'backup-proxy-01', vmid: '230', type: 'VM', node: 'pve1', cluster: 'prod', vcpus: 4, memoryGb: 8, diskGb: 2048 },
    { rank: 2, name: 'fileserver-01', vmid: '231', type: 'VM', node: 'pve2', cluster: 'prod', vcpus: 4, memoryGb: 8, diskGb: 1024 },
    { rank: 3, name: 'sap-hana-01', vmid: '220', type: 'VM', node: 'pve3', cluster: 'prod', vcpus: 12, memoryGb: 128, diskGb: 500 },
  ],
}

const NODE_HW: Record<string, any> = {
  pve1: { node: 'pve1', cluster: 'prod', cpuModel: 'AMD EPYC 7443P 24-Core', cores: 48, memoryGb: 256, interfaceCount: 4, interfaceCountByType: { eth: 4, bridge: 2, bond: 1 }, diskCount: 6, diskCountByType: { nvme: 2, ssd: 4 }, disks: [{ devpath: '/dev/nvme0n1', type: 'nvme', sizeGb: 1920, health: 'PASSED' }, { devpath: '/dev/nvme1n1', type: 'nvme', sizeGb: 1920, health: 'PASSED' }, { devpath: '/dev/sda', type: 'ssd', sizeGb: 3840, health: 'PASSED' }, { devpath: '/dev/sdb', type: 'ssd', sizeGb: 3840, health: 'PASSED' }, { devpath: '/dev/sdc', type: 'ssd', sizeGb: 480, health: 'PASSED' }, { devpath: '/dev/sdd', type: 'ssd', sizeGb: 480, health: 'PASSED' }] },
  pve2: { node: 'pve2', cluster: 'prod', cpuModel: 'AMD EPYC 7443P 24-Core', cores: 48, memoryGb: 256, interfaceCount: 6, interfaceCountByType: { eth: 6, bridge: 2, bond: 2 }, diskCount: 8, diskCountByType: { nvme: 1, hdd: 7 }, disks: [{ devpath: '/dev/nvme0n1', type: 'nvme', sizeGb: 1920, health: 'PASSED' }, { devpath: '/dev/sda', type: 'hdd', sizeGb: 8000, health: 'PASSED' }, { devpath: '/dev/sdb', type: 'hdd', sizeGb: 8000, health: 'PASSED' }, { devpath: '/dev/sdc', type: 'hdd', sizeGb: 8000, health: 'PASSED' }, { devpath: '/dev/sdd', type: 'hdd', sizeGb: 8000, health: 'PASSED' }, { devpath: '/dev/sde', type: 'hdd', sizeGb: 8000, health: 'PASSED' }, { devpath: '/dev/sdf', type: 'hdd', sizeGb: 8000, health: 'FAILED' }, { devpath: '/dev/sdg', type: 'hdd', sizeGb: 480, health: 'PASSED' }] },
  pve3: { node: 'pve3', cluster: 'prod', cpuModel: 'Intel Xeon Gold 6326', cores: 32, memoryGb: 192, interfaceCount: 4, interfaceCountByType: { eth: 4, bridge: 2 }, diskCount: 5, diskCountByType: { nvme: 1, ssd: 4 }, disks: [{ devpath: '/dev/nvme0n1', type: 'nvme', sizeGb: 3840, health: 'PASSED' }, { devpath: '/dev/sda', type: 'ssd', sizeGb: 1920, health: 'PASSED' }, { devpath: '/dev/sdb', type: 'ssd', sizeGb: 1920, health: 'PASSED' }, { devpath: '/dev/sdc', type: 'ssd', sizeGb: 1920, health: 'PASSED' }, { devpath: '/dev/sdd', type: 'ssd', sizeGb: 480, health: 'PASSED' }] },
  lab1: { node: 'lab1', cluster: 'lab', cpuModel: 'Intel Xeon E-2288G', cores: 16, memoryGb: 64, interfaceCount: 2, interfaceCountByType: { eth: 2, bridge: 1 }, diskCount: 2, diskCountByType: { ssd: 2 }, disks: [{ devpath: '/dev/sda', type: 'ssd', sizeGb: 960, health: 'PASSED' }, { devpath: '/dev/sdb', type: 'ssd', sizeGb: 960, health: 'PASSED' }] },
  lab2: { node: 'lab2', cluster: 'lab', cpuModel: 'Intel Xeon E-2288G', cores: 16, memoryGb: 64, interfaceCount: 2, interfaceCountByType: { eth: 2, bridge: 1 }, diskCount: 3, diskCountByType: { nvme: 1, ssd: 2 }, disks: [{ devpath: '/dev/nvme0n1', type: 'nvme', sizeGb: 1000, health: 'PASSED' }, { devpath: '/dev/sda', type: 'ssd', sizeGb: 960, health: 'PASSED' }, { devpath: '/dev/sdb', type: 'ssd', sizeGb: 960, health: 'PASSED' }] },
}

const STORAGES = [
  { name: 'ceph-vm-pool', cluster: 'prod', type: 'rbd', shared: true, totalGb: 20480, usedGb: 11059, freeGb: 9421, usedPct: 54.0, contentTypes: ['images', 'rootdir'], nodeCount: 3 },
  { name: 'nfs-backup', cluster: 'prod', type: 'nfs', shared: true, totalGb: 8192, usedGb: 6963, freeGb: 1229, usedPct: 85.0, contentTypes: ['backup', 'iso'], nodeCount: 3 },
  { name: 'local-lvm', cluster: 'prod', type: 'lvmthin', shared: false, totalGb: 900, usedGb: 846, freeGb: 54, usedPct: 94.0, contentTypes: ['images', 'rootdir'], nodeCount: 1 },
  { name: 'local', cluster: 'prod', type: 'dir', shared: false, totalGb: 94, usedGb: 21, freeGb: 73, usedPct: 22.3, contentTypes: ['iso', 'vztmpl', 'backup'], nodeCount: 3 },
  { name: 'lab-zfs', cluster: 'lab', type: 'zfspool', shared: false, totalGb: 1800, usedGb: 640, freeGb: 1160, usedPct: 35.6, contentTypes: ['images', 'rootdir'], nodeCount: 2 },
]

const CEPH_FINDINGS = [
  { finding: 'osd.7 on pve3 is 86% full, above the 85% nearfull threshold', value: 86, unit: '%', osd: 'osd.7', host: 'pve3' },
  { finding: 'pool ceph-vm-pool has 64 placement groups for 11 OSDs, the recommended count is 256', value: 64, unit: 'pgs', recommended: 256 },
  { finding: 'only 2 monitors are configured, 3 are needed to survive the loss of one', value: 2, unit: 'monitors', recommended: 3 },
]

const OSDS = [
  { id: 'osd.0', host: 'pve1', deviceClass: 'nvme', up: true, in: true, usedPct: 52, applyMs: 4, commitMs: 4 },
  { id: 'osd.1', host: 'pve1', deviceClass: 'nvme', up: true, in: true, usedPct: 55, applyMs: 3, commitMs: 3 },
  { id: 'osd.2', host: 'pve1', deviceClass: 'ssd', up: true, in: true, usedPct: 49, applyMs: 9, commitMs: 8 },
  { id: 'osd.3', host: 'pve1', deviceClass: 'ssd', up: true, in: true, usedPct: 51, applyMs: 11, commitMs: 10 },
  { id: 'osd.4', host: 'pve2', deviceClass: 'nvme', up: true, in: true, usedPct: 53, applyMs: 5, commitMs: 4 },
  { id: 'osd.5', host: 'pve2', deviceClass: 'hdd', up: true, in: true, usedPct: 58, applyMs: 27, commitMs: 25 },
  { id: 'osd.6', host: 'pve2', deviceClass: 'hdd', up: true, in: true, usedPct: 57, applyMs: 31, commitMs: 29 },
  { id: 'osd.7', host: 'pve3', deviceClass: 'hdd', up: true, in: true, usedPct: 86, applyMs: 42, commitMs: 39 },
  { id: 'osd.8', host: 'pve2', deviceClass: 'hdd', up: true, in: true, usedPct: 56, applyMs: 24, commitMs: 22 },
  { id: 'osd.9', host: 'pve3', deviceClass: 'nvme', up: true, in: true, usedPct: 50, applyMs: 4, commitMs: 3 },
  { id: 'osd.10', host: 'pve3', deviceClass: 'ssd', up: true, in: true, usedPct: 48, applyMs: 10, commitMs: 9 },
]

function canned(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case 'list_hosts':
      return { hosts: nodes.map(n => ({ name: n.name, cluster: n.cluster, status: n.status, cpuPct: n.cpuPct, memPct: n.memPct, cores: n.cores })) }
    case 'list_guests': {
      const status = String(args.status ?? 'all')
      const list = guests.filter(x => status === 'all' || (status === 'running' ? x.status === 'running' : x.status !== 'running'))

      return { total: list.length, guests: list.slice(0, Number(args.limit ?? 100)).map(x => ({ name: x.name, vmid: x.vmid, type: x.type, status: x.status, node: x.node, cluster: x.cluster, cpuPct: x.cpuPct, memPct: x.memPct })) }
    }
    case 'rank_guest_hardware': {
      const metric = String(args.metric ?? 'vcpus')
      const limit = Number(args.limit ?? 10)

      if (metric === 'cpu_usage' || metric === 'memory_usage') {
        const key = metric === 'cpu_usage' ? 'cpuPct' : 'memPct'
        const ranking = guests.filter(x => !x.template).sort((a, b) => b[key] - a[key]).slice(0, limit)
          .map((x, i) => ({ rank: i + 1, name: x.name, vmid: x.vmid, type: x.type, node: x.node, cluster: x.cluster, vcpus: x.vcpus, memoryGb: x.memTotalGb, diskGb: x.diskTotalGb, cpuUsagePct: x.cpuPct, memoryUsagePct: x.memPct }))

        return { metric, unit: '%', statusFilter: args.status ?? 'all', totalConsidered: 38, ranking }
      }

      return { metric, unit: metric === 'vcpus' ? 'vCPU' : 'GB', statusFilter: args.status ?? 'all', totalConsidered: 38, ranking: RANKINGS[metric].slice(0, limit) }
    }
    case 'get_guest_hardware': {
      const ref = String(args.guest ?? '')
      const guest = guests.find(x => x.name === ref || x.vmid === ref)

      if (!guest) return { error: `No visible guest matches "${ref}".` }

      return { name: guest.name, vmid: guest.vmid, type: guest.type, node: guest.node, cluster: guest.cluster, cores: guest.vcpus, sockets: 1, vcpus: guest.vcpus, cpuType: 'x86-64-v2-AES', memoryGb: guest.memTotalGb, bios: 'ovmf', disks: [{ id: 'scsi0', storage: 'ceph-vm-pool', sizeGb: guest.diskTotalGb, usedInsideGuestGb: guest.name === 'backup-proxy-01' ? 1800 : undefined }], networks: [{ id: 'net0', bridge: 'vmbr0', vlan: 10, mac: '02:00:00:00:00:01' }] }
    }
    case 'get_node_hardware': {
      const ref = String(args.node ?? '')
      const hw = NODE_HW[ref]

      if (!hw) return { error: `No visible host matches "${ref || 'nothing'}". Hosts: ${Object.keys(NODE_HW).join(', ')}.` }

      return hw
    }
    case 'rank_storage': {
      const metric = String(args.metric ?? 'total')
      const sorted = [...STORAGES].sort((a, b) => metric === 'free' ? a.freeGb - b.freeGb : metric === 'used_pct' ? b.usedPct - a.usedPct : b.totalGb - a.totalGb)

      return { metric, unit: 'GB', totalConsidered: STORAGES.length, ranking: sorted.slice(0, Number(args.limit ?? 5)).map((s, i) => ({ rank: i + 1, ...s })) }
    }
    case 'get_ceph_status': {
      const focus = String(args.focus ?? 'all')
      const byClass = { nvme: 4, ssd: 4, hdd: 3 }

      if (focus === 'improvements') return { cluster: 'prod', health: 'HEALTH_WARN', findings: CEPH_FINDINGS }
      if (focus === 'devices') return { cluster: 'prod', osdCount: 11, osdCountByDeviceClass: byClass }
      if (focus === 'capacity') return { cluster: 'prod', totalGb: 20480, usedGb: 11059, freeGb: 9421, usedPct: 54.0, pools: [{ name: 'ceph-vm-pool', usedGb: 11059, pgs: 64 }] }

      return { cluster: 'prod', health: 'HEALTH_WARN', healthChecks: ['OSD_NEARFULL: 1 nearfull osd(s)', 'TOO_FEW_PGS: too few PGs per OSD (17 < min 30)'], monitors: 2, managers: 2, osdCount: 11, osdCountByDeviceClass: byClass, totalGb: 20480, usedGb: 11059, usedPct: 54.0, findings: CEPH_FINDINGS }
    }
    case 'list_ceph_osds': {
      const sortBy = String(args.sortBy ?? 'id')
      const sorted = [...OSDS].sort((a, b) => sortBy === 'latency' ? b.applyMs - a.applyMs : sortBy === 'usage' ? b.usedPct - a.usedPct : 0)
      const byHost = { pve1: 4, pve2: 4, pve3: 3 }

      return { cluster: 'prod', osdCount: 11, byHost, byDeviceClass: { nvme: 4, ssd: 4, hdd: 3 }, latency: { avgApplyMs: 15.5, maxApplyMs: 42, maxCommitMs: 39, slowest: { id: 'osd.7', host: 'pve3', deviceClass: 'hdd', applyMs: 42, commitMs: 39 } }, osds: sorted.slice(0, Number(args.limit ?? 30)) }
    }
    default:
      return { error: `Unknown tool "${name}". Available tools: ${READ_ONLY_TOOLS.map(t => t.name).join(', ')}.` }
  }
}

/**
 * The stubs validate enum arguments exactly like the real tools (`argEnum`), so
 * a model that invents a value gets the same error it would get in production
 * and a correct value is never scored as wrong because the stub spelled it
 * differently. The 30/08 run scored llama3.1's correct metric="used_pct" as a
 * miss for that very reason.
 */
// Ordering-only arguments the real tool reads with `argPresentationEnum`: an
// unknown value falls back to the default there instead of being refused.
const PRESENTATION_ARGS: Record<string, string[]> = { list_ceph_osds: ['groupBy', 'sortBy'] }

function validateEnums(tool: CatalogTool, args: Record<string, unknown>) {
  for (const [key, prop] of Object.entries(tool.parameters.properties)) {
    const raw = args[key]

    if (!prop.enum || raw === undefined || raw === null || raw === '') continue
    if (PRESENTATION_ARGS[tool.name]?.includes(key)) continue

    const value = String(raw).trim().toLowerCase()

    if (!prop.enum.includes(value)) {
      throw new ToolArgumentError(`Invalid value "${value}" for "${key}". Accepted values: ${prop.enum.join(', ')}.`)
    }
  }
}

const stubTools: CatalogTool[] = READ_ONLY_TOOLS.map(t => ({
  ...t,
  execute: async args => {
    validateEnums(t, args)

    return canned(t.name, args)
  },
}))

/* ------------------------------------------------------------------ */
/* Questions: the reporter's list, with the tool each one needs       */
/* ------------------------------------------------------------------ */

type Question = {
  id: string
  en: string
  fr: string
  /** Any of these names on the first round counts as the right tool; for a control question, the only tools tolerated. */
  tools: string[]
  /** Every one of these must appear in the final answer (case-insensitive). */
  answer: string[]
  /** True when the snapshot already holds the answer and no tool is needed. */
  control?: boolean
}

const QUESTIONS: Question[] = [
  { id: 'vcpus', en: 'Which VM has the most vCPUs assigned?', fr: 'Quelle VM a le plus de vCPU assignés ?', tools: ['rank_guest_hardware'], answer: ['build-runner-03'] },
  { id: 'memory', en: 'Which VM has the most memory assigned?', fr: 'Quelle VM a le plus de mémoire assignée ?', tools: ['rank_guest_hardware'], answer: ['sap-hana-01'] },
  { id: 'disk', en: 'Which VM has the most consumed disk space?', fr: 'Quelle VM consomme le plus d\'espace disque ?', tools: ['rank_guest_hardware', 'get_guest_hardware'], answer: ['backup-proxy-01'] },
  { id: 'nics', en: 'How many network interfaces does host pve1 have?', fr: 'Combien d\'interfaces réseau a l\'hôte pve1 ?', tools: ['get_node_hardware'], answer: ['4'] },
  { id: 'disks', en: 'How many hard disks does host pve2 have?', fr: 'Combien de disques durs a l\'hôte pve2 ?', tools: ['get_node_hardware'], answer: ['8'] },
  { id: 'biggest-storage', en: 'What is the biggest storage device?', fr: 'Quel est le plus gros stockage ?', tools: ['rank_storage'], answer: ['ceph-vm-pool'] },
  { id: 'least-free', en: 'Which storage device has the least amount of free space?', fr: 'Quel stockage a le moins d\'espace libre ?', tools: ['rank_storage'], answer: ['local-lvm'] },
  { id: 'osds-per-host', en: 'How many OSDs are on each host?', fr: 'Combien d\'OSD y a-t-il sur chaque hôte ?', tools: ['list_ceph_osds', 'get_ceph_status'], answer: ['pve1', 'pve2', 'pve3', '3'] },
  { id: 'latency', en: 'What is the highest disk latency seen?', fr: 'Quelle est la latence disque la plus élevée observée ?', tools: ['list_ceph_osds'], answer: ['42'] },
  { id: 'ceph-improve', en: 'Are there any improvements to Ceph that can be made?', fr: 'Y a-t-il des améliorations à apporter à Ceph ?', tools: ['get_ceph_status'], answer: ['86', '64'] },
  { id: 'nvme', en: 'How many NVMe devices are in the infrastructure?', fr: 'Combien de périphériques NVMe y a-t-il dans l\'infrastructure ?', tools: ['get_ceph_status', 'list_ceph_osds', 'get_node_hardware'], answer: ['4'] },
  { id: 'control-cpu', en: 'Which VM is using the most CPU right now?', fr: 'Quelle VM utilise le plus de CPU en ce moment ?', tools: ['rank_guest_hardware', 'list_guests'], answer: ['db-01'], control: true },
]

/**
 * Paraphrases of the same questions, the way an operator types them. Same
 * expected tool and figure; what changes is that none of the tool descriptions
 * is quoted verbatim, so a model that only matches wording fails here.
 */
const VARIANT_QUESTIONS: Question[] = [
  { id: 'v-vcpus', en: 'Biggest VM in terms of CPU cores given to it?', fr: 'La plus grosse VM en nombre de cœurs attribués ?', tools: ['rank_guest_hardware'], answer: ['build-runner-03'] },
  { id: 'v-memory', en: 'Who got the most RAM allocated among all guests?', fr: 'Quel invité a reçu le plus de RAM ?', tools: ['rank_guest_hardware'], answer: ['sap-hana-01'] },
  { id: 'v-disk', en: 'Top 3 guests by provisioned disk please', fr: 'Top 3 des invités par disque provisionné, s\'il te plaît', tools: ['rank_guest_hardware'], answer: ['backup-proxy-01', 'fileserver-01'] },
  { id: 'v-nics', en: 'pve1: number of NICs?', fr: 'pve1 : nombre de cartes réseau ?', tools: ['get_node_hardware'], answer: ['4'] },
  { id: 'v-disks', en: 'is any disk failing on pve2?', fr: 'un disque est-il en défaut sur pve2 ?', tools: ['get_node_hardware'], answer: ['sdf'] },
  { id: 'v-storage-full', en: 'which datastore is almost full?', fr: 'quel datastore est presque plein ?', tools: ['rank_storage'], answer: ['local-lvm'] },
  { id: 'v-osd-slow', en: 'slowest OSD?', fr: 'OSD le plus lent ?', tools: ['list_ceph_osds'], answer: ['osd.7'] },
  { id: 'v-ceph-wrong', en: 'anything wrong with ceph?', fr: 'un souci côté ceph ?', tools: ['get_ceph_status'], answer: ['86'] },
  { id: 'v-hw-sheet', en: 'show me the hardware config of sap-hana-01', fr: 'montre-moi la config matérielle de sap-hana-01', tools: ['get_guest_hardware'], answer: ['128'] },
  { id: 'v-control-ram', en: 'Which host is the most loaded in RAM right now?', fr: 'Quel hôte est le plus chargé en RAM en ce moment ?', tools: ['list_hosts'], answer: ['pve3'], control: true },
]

const ACTIVE_QUESTIONS = VARIANTS ? VARIANT_QUESTIONS : QUESTIONS

/* ------------------------------------------------------------------ */
/* One turn, exactly as the route sends it                            */
/* ------------------------------------------------------------------ */

const systemPrompt = renderAiSystemPrompt(snapshot, alerts, LANG, LOCALE, { toolsEnabled: true })
const wireTools = toolsForProvider('ollama', READ_ONLY_TOOLS)
const userInstruction = LANG === 'fr'
  ? 'Réponds en utilisant les données de l\'infrastructure ci-dessus, ou appelle un outil si la réponse n\'y figure pas. Cite les noms exacts des VMs et leurs métriques.'
  : 'Respond using the infrastructure data above, or call a tool if the answer is not in it. Cite exact VM names and their metrics.'

function contextualize(question: string): string {
  return `${systemPrompt}

=== ${LANG === 'fr' ? 'QUESTION DE L\'UTILISATEUR' : 'USER QUESTION'} ===
${question}

${userInstruction}

${languageInstruction(LOCALE)}`
}

type TurnStats = { status: number; promptEvalCount?: number; evalCount?: number; totalMs?: number }

async function ollamaTurn(model: string, messages: any[], mode: ToolMode, stats: TurnStats[]): Promise<any> {
  const body: any = {
    model,
    messages,
    stream: false,
    ...(mode === 'auto' ? { tools: wireTools } : {}),
    ...(NO_THINK ? { think: false } : {}),
    options: { ...ollamaOptions(), ...(NUM_CTX ? { num_ctx: NUM_CTX } : {}) },
  }
  const res = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const text = await res.text()

  if (!res.ok) {
    stats.push({ status: res.status })
    throw new Error(`Ollama error: ${text}`)
  }

  const json = JSON.parse(text)

  stats.push({ status: res.status, promptEvalCount: json.prompt_eval_count, evalCount: json.eval_count, totalMs: json.total_duration ? Math.round(json.total_duration / 1e6) : undefined })

  return json
}

/* ------------------------------------------------------------------ */
/* Model facts from /api/show                                         */
/* ------------------------------------------------------------------ */

type ModelFacts = { capabilities: string[]; supportsTools: boolean; contextLength?: number; numCtxParam?: number; family?: string; parameterSize?: string; quantization?: string }

async function showModel(model: string): Promise<ModelFacts> {
  const res = await fetch(`${OLLAMA}/api/show`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) })
  const json: any = await res.json()
  const capabilities: string[] = Array.isArray(json.capabilities) ? json.capabilities : []
  const info = json.model_info ?? {}
  const ctxKey = Object.keys(info).find(k => k.endsWith('.context_length'))
  const numCtx = /num_ctx\s+(\d+)/.exec(String(json.parameters ?? ''))

  return {
    capabilities,
    supportsTools: capabilities.includes('tools'),
    contextLength: ctxKey ? Number(info[ctxKey]) : undefined,
    numCtxParam: numCtx ? Number(numCtx[1]) : undefined,
    family: json.details?.family,
    parameterSize: json.details?.parameter_size,
    quantization: json.details?.quantization_level,
  }
}

/* ------------------------------------------------------------------ */
/* Scoring                                                            */
/* ------------------------------------------------------------------ */

type QuestionResult = {
  id: string
  run: number
  firstCalls: Array<{ name: string; args: Record<string, unknown> }>
  firstToolOk: boolean
  answerOk: boolean
  leaked: boolean
  rounds: number
  budgetExhausted: boolean
  toolsDisabled: boolean
  error?: string
  httpStatuses: number[]
  promptEvalCount?: number
  maxPromptEvalCount?: number
  wallMs: number
  answer: string
}

const TOOL_NAMES = READ_ONLY_TOOLS.map(t => t.name)

function leaks(text: string): boolean {
  const lower = text.toLowerCase()

  return TOOL_NAMES.some(n => lower.includes(n)) || /\{\s*"(name|tool|function|parameters|arguments)"/.test(text) || lower.includes('we could run')
}

async function askOne(model: string, q: Question, run: number): Promise<QuestionResult> {
  const stats: TurnStats[] = []
  const firstCalls: QuestionResult['firstCalls'] = []
  const started = Date.now()
  const ctx: ToolContext = { snapshot, tenantId: 'bench', locale: LOCALE }
  let seenCalls = false

  try {
    let text: string
    let rounds = 0
    let budgetExhausted = false
    let toolsDisabled = false

    if (FIRST_ONLY) {
      // One turn, no execution: what did the model do with the question?
      const json = await ollamaTurn(model, [{ role: 'user', content: contextualize(q[LANG]) }], 'auto', stats)
      let calls = parseToolCalls('ollama', json)

      text = parseAssistantText('ollama', json)

      if (calls.length === 0) {
        const recovered = extractTextToolCall(text, TOOL_NAMES)

        if (recovered) calls = [recovered]
      }

      firstCalls.push(...calls.map(c => ({ name: c.name, args: c.args })))
    } else {
      const outcome = await runToolRounds({
        provider: 'ollama',
        tools: stubTools,
        ctx,
        messages: [{ role: 'user', content: contextualize(q[LANG]) }],
        send: (msgs, mode) => ollamaTurn(model, msgs, mode, stats),
        onToolCalls: calls => {
          if (seenCalls) return
          seenCalls = true
          firstCalls.push(...calls.map(c => ({ name: c.name, args: c.args })))
        },
      })

      text = outcome.text
      rounds = outcome.rounds
      budgetExhausted = outcome.budgetExhausted
      toolsDisabled = outcome.toolsDisabled
    }

    const outcome = { text, rounds, budgetExhausted, toolsDisabled }

    // A control question is answerable from the snapshot: no call is the ideal,
    // a call to a tool that carries the same data is acceptable, anything else
    // (a hardware ranking for a load question, say) is a miss.
    const firstToolOk = q.control
      ? firstCalls.every(c => q.tools.includes(c.name))
      : firstCalls.some(c => q.tools.includes(c.name))
    const lower = outcome.text.toLowerCase()
    const answerOk = q.answer.every(a => lower.includes(a.toLowerCase()))

    return {
      id: q.id, run, firstCalls, firstToolOk, answerOk, leaked: leaks(outcome.text),
      rounds: outcome.rounds, budgetExhausted: outcome.budgetExhausted, toolsDisabled: outcome.toolsDisabled,
      httpStatuses: stats.map(s => s.status), promptEvalCount: stats[0]?.promptEvalCount, maxPromptEvalCount: Math.max(0, ...stats.map(s => s.promptEvalCount ?? 0)) || undefined, wallMs: Date.now() - started, answer: outcome.text,
    }
  } catch (e: any) {
    return {
      id: q.id, run, firstCalls, firstToolOk: false, answerOk: false, leaked: false, rounds: 0, budgetExhausted: false, toolsDisabled: false,
      error: String(e?.message || e).slice(0, 300), httpStatuses: stats.map(s => s.status), promptEvalCount: stats[0]?.promptEvalCount, wallMs: Date.now() - started, answer: '',
    }
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */

/**
 * Where does the time go? The same first turn, repeated, at each context size.
 * `prompt_eval_duration` is the prefill (and drops to near zero when Ollama's
 * prefix cache hits), `eval_duration` is generation. Reported per call so a
 * cache miss on every call shows up as a flat prefill instead of a first-call spike.
 */
async function latencyProbe(models: string[]) {
  const question = QUESTIONS[0]
  const ctxValues = flag('ctx-values') ? (flag('ctx-values') as string).split(',').map(Number) : [4096, 8192, 16384]
  const repeats = Number(flag('repeats', '3'))

  for (const model of models) {
    console.log(`## ${model}`)
    console.log(`${pad('num_ctx', 8)} ${pad('call', 5)} ${pad('prompt_tok', 10)} ${pad('prefill_ms', 10)} ${pad('gen_tok', 8)} ${pad('gen_ms', 8)} ${pad('tok/s', 6)} ${pad('total_ms', 9)} tool`)

    for (const ctx of ctxValues) {
      for (let i = 1; i <= repeats; i++) {
        const body = { model, messages: [{ role: 'user', content: contextualize(question[LANG]) }], stream: false, tools: wireTools, options: { ...ollamaOptions(), num_ctx: ctx } }
        const res = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const json: any = await res.json()
        const ms = (ns?: number) => (ns ? Math.round(ns / 1e6) : 0)
        const genMs = ms(json.eval_duration)
        const tokS = genMs ? Math.round((json.eval_count ?? 0) / (genMs / 1000)) : 0
        const calls = parseToolCalls('ollama', json)

        console.log(`${pad(ctx, 8)} ${pad(i, 5)} ${pad(json.prompt_eval_count ?? '?', 10)} ${pad(ms(json.prompt_eval_duration), 10)} ${pad(json.eval_count ?? '?', 8)} ${pad(genMs, 8)} ${pad(tokS, 6)} ${pad(ms(json.total_duration), 9)} ${calls.map(c => c.name).join('+') || '-'}`)
      }
    }

    console.log()
  }
}

async function listModels(): Promise<string[]> {
  const res = await fetch(`${OLLAMA}/api/tags`)
  const json: any = await res.json()

  return (json.models ?? []).map((m: any) => m.name as string).sort()
}

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n)
}

async function main() {
  const approxTokens = Math.round((contextualize(QUESTIONS[0][LANG]).length + JSON.stringify(wireTools).length) / 4)

  console.log(`# AI tool bench, lang=${LANG}${VARIANTS ? ', paraphrased variants' : ''}, ollama=${OLLAMA}${NUM_CTX ? `, num_ctx=${NUM_CTX}` : ''}${NO_THINK ? ', think=false' : ''}${FIRST_ONLY ? ', first round only' : ''}, runs=${RUNS}`)
  console.log(`prompt: ${systemPrompt.length} chars, tools: ${JSON.stringify(wireTools).length} chars, roughly ${approxTokens} tokens per first turn\n`)

  if (DRY) {
    console.log(contextualize(QUESTIONS[0][LANG]))
    console.log('\n--- tools ---')
    console.log(JSON.stringify(wireTools, null, 1).slice(0, 3000))

    return
  }

  const models = flag('models') ? (flag('models') as string).split(',').map(s => s.trim()).filter(Boolean) : await listModels()

  if (LATENCY_PROBE) {
    await latencyProbe(models)

    return
  }
  const report: any = { lang: LANG, numCtx: NUM_CTX, firstOnly: FIRST_ONLY, runs: RUNS, promptChars: systemPrompt.length, toolsChars: JSON.stringify(wireTools).length, models: {} }
  const summary: string[] = []

  for (const model of models) {
    let facts: ModelFacts

    try {
      facts = await showModel(model)
    } catch (e: any) {
      console.log(`## ${model}: /api/show failed: ${e?.message}`)
      continue
    }

    console.log(`## ${model}  (${facts.family ?? '?'} ${facts.parameterSize ?? ''} ${facts.quantization ?? ''}; capabilities=${facts.capabilities.join('|') || 'none reported'}; context_length=${facts.contextLength ?? '?'}${facts.numCtxParam ? `, num_ctx param=${facts.numCtxParam}` : ''})`)
    console.log(`${pad('question', 18)} ${pad('first call', 42)} ${pad('tool', 5)} ${pad('answer', 6)} ${pad('leak', 5)} ${pad('rounds', 6)} ${pad('prompt_tok', 10)} ${pad('max_tok', 8)} ${pad('ms', 7)} note`)

    const results: QuestionResult[] = []

    for (let run = 1; run <= RUNS; run++) {
      for (const q of ACTIVE_QUESTIONS) {
        const r = await askOne(model, q, run)

        results.push(r)

        const first = r.firstCalls.length ? r.firstCalls.map(c => `${c.name}(${Object.entries(c.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(',')})`).join(' + ') : (r.error ? '(error)' : '(no tool)')
        const note = r.error ? `HTTP ${r.httpStatuses.join(',') || '?'}: ${r.error.slice(0, 80)}` : r.toolsDisabled ? 'degraded to prompt-only' : r.budgetExhausted ? 'budget exhausted' : ''

        console.log(`${pad(q.id, 18)} ${pad(first.slice(0, 42), 42)} ${pad(r.firstToolOk ? 'ok' : 'KO', 5)} ${pad(r.answerOk ? 'ok' : 'KO', 6)} ${pad(r.leaked ? 'LEAK' : '-', 5)} ${pad(r.rounds, 6)} ${pad(r.promptEvalCount ?? '?', 10)} ${pad(r.maxPromptEvalCount ?? '?', 8)} ${pad(r.wallMs, 7)} ${note}`)
      }
    }

    const scored = results.filter(r => !ACTIVE_QUESTIONS.find(q => q.id === r.id)?.control)
    const controls = results.filter(r => ACTIVE_QUESTIONS.find(q => q.id === r.id)?.control)
    const errors = results.filter(r => r.error).length
    const toolOk = scored.filter(r => r.firstToolOk).length
    const answerOk = scored.filter(r => r.answerOk).length
    const leaked = results.filter(r => r.leaked).length
    const avgMs = Math.round(results.reduce((a, r) => a + r.wallMs, 0) / Math.max(results.length, 1))
    const promptTok = results.find(r => r.promptEvalCount)?.promptEvalCount
    const maxTok = Math.max(0, ...results.map(r => r.maxPromptEvalCount ?? 0))
    const effectiveCtx = NUM_CTX ?? ollamaOptions().num_ctx
    const ctxWarn = maxTok >= effectiveCtx * 0.95 ? ` ⚠ a turn reached ${maxTok} prompt tokens for an effective num_ctx of ${effectiveCtx}: the context was truncated` : ''
    const line = `${pad(model, 40)} tools cap: ${pad(facts.supportsTools ? 'yes' : 'NO', 4)} right tool: ${pad(`${toolOk}/${scored.length}`, 6)} right answer: ${pad(`${answerOk}/${scored.length}`, 6)} control: ${pad(`${controls.filter(r => r.firstToolOk && r.answerOk).length}/${controls.length}`, 4)} leaks: ${pad(leaked, 3)} errors: ${pad(errors, 3)} avg ${avgMs} ms, prompt ${promptTok ?? '?'} tok (max ${maxTok || '?'})${ctxWarn}`

    console.log(`\n${line}\n`)
    summary.push(line)
    report.models[model] = { facts, results }
  }

  console.log('# Summary')
  summary.forEach(l => console.log(l))

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(report, null, 2))
  console.log(`\nraw results: ${OUT}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
