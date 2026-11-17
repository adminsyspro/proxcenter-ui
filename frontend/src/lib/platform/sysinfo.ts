// What a container can read of itself and of its host without any privilege:
// /proc for the host load and memory, the cgroup files for the container's own
// memory and CPU. Every reader returns null rather than throwing when a file
// is missing (cgroup v1, a non-Linux development host), so the status page
// shows what it can. Twin of the orchestrator's internal/sysinfo package.

import { readFile, statfs } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { ContainerInfo, DiskInfo, HostInfo } from './types'

async function read(root: string, ...parts: string[]): Promise<string | null> {
  try {
    return (await readFile(path.join(root, ...parts), 'utf8')).trim()
  } catch {
    return null
  }
}

function meminfoBytes(meminfo: string, key: string): number {
  for (const line of meminfo.split('\n')) {
    const at = line.indexOf(':')

    if (at === -1 || line.slice(0, at) !== key) continue
    const kb = Number.parseInt(line.slice(at + 1).trim().split(/\s+/)[0] ?? '', 10)

    return Number.isFinite(kb) ? kb * 1024 : 0
  }

  return 0
}

/** Host figures; inside a container /proc still describes the whole host. */
export async function readHost(procRoot = '/proc'): Promise<HostInfo | null> {
  const loadavg = await read(procRoot, 'loadavg')
  const fields = loadavg?.split(/\s+/).slice(0, 3).map(Number) ?? []

  if (fields.length < 3 || fields.some(v => !Number.isFinite(v))) return null

  const [meminfo, uptime] = await Promise.all([read(procRoot, 'meminfo'), read(procRoot, 'uptime')])
  const uptimeSeconds = Number(uptime?.split(/\s+/)[0])

  return {
    load1: fields[0],
    load5: fields[1],
    load15: fields[2],
    cpus: os.cpus().length,
    memTotalBytes: meminfo ? meminfoBytes(meminfo, 'MemTotal') : 0,
    memAvailableBytes: meminfo ? meminfoBytes(meminfo, 'MemAvailable') : 0,
    uptimeSeconds: Number.isFinite(uptimeSeconds) ? uptimeSeconds : 0
  }
}

export interface ContainerReading {
  memoryBytes: number
  memoryLimitBytes: number
  cpuUsageUsec: number
  cpuLimit: number
}

const num = (raw: string | null | undefined): number => {
  const v = Number(raw)

  return Number.isFinite(v) ? v : 0
}

/** The calling process's cgroup, v2 first then v1; null when neither is readable. */
export async function readContainer(cgroupRoot = '/sys/fs/cgroup'): Promise<ContainerReading | null> {
  const current = await read(cgroupRoot, 'memory.current')

  if (current !== null) {
    const [limit, stat, max] = await Promise.all([read(cgroupRoot, 'memory.max'), read(cgroupRoot, 'cpu.stat'), read(cgroupRoot, 'cpu.max')])
    const usage = stat?.split('\n').find(line => line.startsWith('usage_usec '))
    const [quota, period] = max?.split(/\s+/) ?? []

    return {
      memoryBytes: num(current),
      memoryLimitBytes: limit && limit !== 'max' ? num(limit) : 0,
      cpuUsageUsec: num(usage?.split(/\s+/)[1]),
      cpuLimit: quota && quota !== 'max' && num(period) > 0 ? num(quota) / num(period) : 0
    }
  }

  const usage = await read(cgroupRoot, 'memory', 'memory.usage_in_bytes')

  if (usage === null) return null
  const [limit, cpu] = await Promise.all([read(cgroupRoot, 'memory', 'memory.limit_in_bytes'), read(cgroupRoot, 'cpuacct', 'cpuacct.usage')])
  // cgroup v1 writes a huge page-rounded number for "no limit".
  const limitBytes = num(limit)

  return {
    memoryBytes: num(usage),
    memoryLimitBytes: limitBytes < 2 ** 60 ? limitBytes : 0,
    cpuUsageUsec: Math.floor(num(cpu) / 1000),
    cpuLimit: 0
  }
}

/** Size and space left to an unprivileged process on the file system holding `dir`. */
export async function diskUsage(label: string, dir: string): Promise<DiskInfo | null> {
  try {
    const st = await statfs(dir)

    return { label, path: dir, totalBytes: st.blocks * st.bsize, freeBytes: st.bavail * st.bsize }
  } catch {
    return null
  }
}

// Two close readings (several viewers, a retry) would give a noisy figure
// over a few milliseconds: within this window the previous one is returned.
const MIN_INTERVAL_MS = 2000

/**
 * Turns the cumulative CPU time of a cgroup into a load: the share of one
 * core used between two readings (100 = one full core).
 */
export class CpuMeter {
  private lastUsec = 0
  private lastAt = 0
  private percent: number | null = null

  observe(usageUsec: number, nowMs: number): number | null {
    if (this.lastAt === 0) {
      this.lastUsec = usageUsec
      this.lastAt = nowMs

      return null
    }

    const elapsedMs = nowMs - this.lastAt

    if (elapsedMs < MIN_INTERVAL_MS) return this.percent
    // A counter going backwards is a container restart: keep the last figure.
    if (usageUsec >= this.lastUsec) this.percent = ((usageUsec - this.lastUsec) / (elapsedMs * 1000)) * 100
    this.lastUsec = usageUsec
    this.lastAt = nowMs

    return this.percent
  }
}

export function toContainerInfo(reading: ContainerReading, meter: CpuMeter, nowMs: number): ContainerInfo {
  return {
    memoryBytes: reading.memoryBytes,
    memoryLimitBytes: reading.memoryLimitBytes,
    cpuLimit: reading.cpuLimit,
    cpuPercent: meter.observe(reading.cpuUsageUsec, nowMs)
  }
}
