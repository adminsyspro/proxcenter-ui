import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { CpuMeter, diskUsage, readContainer, readHost, toContainerInfo } from './sysinfo'

const roots: string[] = []

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sysinfo-'))

  roots.push(root)
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true })
    await writeFile(path.join(root, name), content)
  }

  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('readHost', () => {
  it('reads the load, the memory and the uptime of the host', async () => {
    const root = await fixture({
      loadavg: '0.52 1.10 2.25 3/512 12345\n',
      meminfo: 'MemTotal:       16000000 kB\nMemFree:         1000000 kB\nMemAvailable:    8000000 kB\n',
      uptime: '86400.55 172000.00\n'
    })
    const host = await readHost(root)

    expect(host).toMatchObject({
      load1: 0.52,
      load5: 1.1,
      load15: 2.25,
      memTotalBytes: 16000000 * 1024,
      memAvailableBytes: 8000000 * 1024,
      uptimeSeconds: 86400.55
    })
    expect(host!.cpus).toBeGreaterThan(0)
  })

  it('still answers with the load alone', async () => {
    const host = await readHost(await fixture({ loadavg: '1 2 3 1/1 1\n', meminfo: 'Cached: 5 kB\n' }))

    expect(host).toMatchObject({ load1: 1, memTotalBytes: 0, memAvailableBytes: 0, uptimeSeconds: 0 })
  })

  it('is null where /proc is absent or unreadable', async () => {
    expect(await readHost(await fixture({}))).toBeNull()
    expect(await readHost(await fixture({ loadavg: 'garbage\n' }))).toBeNull()
  })
})

describe('readContainer', () => {
  it('reads a cgroup v2 container with its limits', async () => {
    const root = await fixture({
      'memory.current': '268435456\n',
      'memory.max': '1073741824\n',
      'cpu.stat': 'usage_usec 5000000\nuser_usec 4000000\nsystem_usec 1000000\n',
      'cpu.max': '150000 100000\n'
    })

    expect(await readContainer(root)).toEqual({ memoryBytes: 268435456, memoryLimitBytes: 1073741824, cpuUsageUsec: 5000000, cpuLimit: 1.5 })
  })

  it('reports no limit as 0', async () => {
    const root = await fixture({ 'memory.current': '1024\n', 'memory.max': 'max\n', 'cpu.max': 'max 100000\n' })

    expect(await readContainer(root)).toEqual({ memoryBytes: 1024, memoryLimitBytes: 0, cpuUsageUsec: 0, cpuLimit: 0 })
  })

  it('falls back to cgroup v1', async () => {
    const root = await fixture({
      'memory/memory.usage_in_bytes': '2048\n',
      'memory/memory.limit_in_bytes': '9223372036854771712\n',
      'cpuacct/cpuacct.usage': '7000000000\n'
    })

    expect(await readContainer(root)).toEqual({ memoryBytes: 2048, memoryLimitBytes: 0, cpuUsageUsec: 7000000, cpuLimit: 0 })

    const limited = await fixture({ 'memory/memory.usage_in_bytes': '2048\n', 'memory/memory.limit_in_bytes': '4096\n' })

    expect(await readContainer(limited)).toMatchObject({ memoryLimitBytes: 4096, cpuUsageUsec: 0 })
  })

  it('is null outside a container', async () => {
    expect(await readContainer(await fixture({}))).toBeNull()
  })
})

describe('diskUsage', () => {
  it('measures the file system holding a directory', async () => {
    const disk = await diskUsage('data', os.tmpdir())

    expect(disk).toMatchObject({ label: 'data', path: os.tmpdir() })
    expect(disk!.totalBytes).toBeGreaterThan(0)
    expect(disk!.freeBytes).toBeLessThanOrEqual(disk!.totalBytes)
  })

  it('is null for a missing directory', async () => {
    expect(await diskUsage('data', path.join(os.tmpdir(), 'does-not-exist-sysinfo'))).toBeNull()
  })
})

describe('CpuMeter', () => {
  it('turns two readings into a share of one core', () => {
    const meter = new CpuMeter()

    expect(meter.observe(1_000_000, 1_000_000)).toBeNull()
    // Too close to the first reading: nothing to report yet.
    expect(meter.observe(1_100_000, 1_001_000)).toBeNull()
    // 5 s of CPU over 10 s of wall clock: half a core.
    expect(meter.observe(6_000_000, 1_010_000)).toBe(50)
    // A close reading returns the last figure rather than a noisy one.
    expect(meter.observe(6_900_000, 1_011_000)).toBe(50)
    // A counter going backwards (container restart) keeps the last figure.
    expect(meter.observe(10, 1_030_000)).toBe(50)
    // And the next interval is measured from the restarted counter.
    expect(meter.observe(10_000_010, 1_040_000)).toBe(100)
  })

  it('feeds the container summary', () => {
    const meter = new CpuMeter()
    const reading = { memoryBytes: 10, memoryLimitBytes: 20, cpuUsageUsec: 0, cpuLimit: 2 }

    expect(toContainerInfo(reading, meter, 1000)).toEqual({ memoryBytes: 10, memoryLimitBytes: 20, cpuLimit: 2, cpuPercent: null })
    expect(toContainerInfo({ ...reading, cpuUsageUsec: 4_000_000 }, meter, 5000).cpuPercent).toBe(100)
  })
})
