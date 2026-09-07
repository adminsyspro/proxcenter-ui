import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { NFC_STREAM_PROBE_SCRIPT, parseNfcStreamProbe, probeCommand } from './nfc-stream-probe'

const SECTOR = 512
const GRAIN_SECTORS = 128

/**
 * Build a stream-optimized sparse extent by hand: 512 byte header, one
 * descriptor sector, grain markers in LBA order, then the GT/GD/footer
 * markers and the end-of-stream marker. Byte offsets follow the VMware
 * Virtual Disk Format 5.0 specification.
 */
function buildStream(opts: { capacitySectors: number; grains: Array<{ lba: number; payload: number }>; withEnd: boolean }): Buffer {
  const overHead = 2 // header + descriptor, in sectors
  const header = Buffer.alloc(SECTOR)
  header.write('KDMV', 0, 'ascii')
  header.writeUInt32LE(3, 4)                             // version
  header.writeUInt32LE(0x30001, 8)                       // flags: compressed grains + markers
  header.writeBigUInt64LE(BigInt(opts.capacitySectors), 12)
  header.writeBigUInt64LE(BigInt(GRAIN_SECTORS), 20)
  header.writeBigUInt64LE(BigInt(1), 28)                      // descriptorOffset
  header.writeBigUInt64LE(BigInt(1), 36)                      // descriptorSize
  header.writeUInt32LE(512, 44)                          // numGTEsPerGT
  header.writeBigUInt64LE(BigInt(0), 48)                      // rgdOffset
  header.writeBigUInt64LE(BigInt("0xffffffffffffffff"), 56)       // gdOffset unknown in the header copy
  header.writeBigUInt64LE(BigInt(overHead), 64)
  header.writeUInt16LE(1, 77)                            // compressAlgorithm deflate
  const descriptor = Buffer.alloc(SECTOR, 0)
  descriptor.write('# Disk DescriptorFile\nversion=1\n', 0, 'ascii')

  const parts: Buffer[] = [header, descriptor]
  for (const g of opts.grains) {
    const total = Math.ceil((12 + g.payload) / SECTOR) * SECTOR
    const marker = Buffer.alloc(total, 0xab)
    marker.writeBigUInt64LE(BigInt(g.lba), 0)
    marker.writeUInt32LE(g.payload, 8)
    parts.push(marker)
  }
  if (opts.withEnd) {
    // Grain table marker followed by one sector of table, grain directory
    // marker followed by one sector, footer marker followed by a header copy,
    // then end of stream.
    for (const [type, sectors] of [[1, 1], [2, 1], [3, 1]] as const) {
      const m = Buffer.alloc(SECTOR, 0)
      m.writeBigUInt64LE(BigInt(sectors), 0)
      m.writeUInt32LE(0, 8)
      m.writeUInt32LE(type, 12)
      parts.push(m, Buffer.alloc(sectors * SECTOR, 0))
    }
    const eos = Buffer.alloc(SECTOR, 0)
    parts.push(eos)
  }
  return Buffer.concat(parts)
}

describe('parseNfcStreamProbe', () => {
  it('parses the probe line into numbers and a boolean', () => {
    expect(parseNfcStreamProbe('size=1536 pos=1536 position=131072 capacity=4194304 eos=0\n')).toEqual({
      size: 1536, pos: 1536, position: 131072, capacity: 4194304, eos: false,
    })
  })

  it('returns null on anything that is not a probe line', () => {
    expect(parseNfcStreamProbe('')).toBeNull()
    expect(parseNfcStreamProbe('Can\'t locate strict.pm')).toBeNull()
    expect(parseNfcStreamProbe('size=abc pos=1 position=2 capacity=3 eos=0')).toBeNull()
  })
})

describe('probeCommand', () => {
  it('quotes every argument for the remote shell', () => {
    expect(probeCommand('/tmp/v2v/nfc-probe.pl', "/tmp/v2v/disk-0.vmdk", 1024, 65536)).toBe(
      `perl '/tmp/v2v/nfc-probe.pl' '/tmp/v2v/disk-0.vmdk' 1024 65536 2>/dev/null || echo PROBE_FAILED`,
    )
  })
})

describe('NFC_STREAM_PROBE_SCRIPT against a synthetic stream', () => {
  let dir: string
  let script: string
  const capacitySectors = 20 * GRAIN_SECTORS // 20 grains, 1.25 MiB
  const grains = [
    { lba: 0 * GRAIN_SECTORS, payload: 700 },
    { lba: 1 * GRAIN_SECTORS, payload: 1500 },
    { lba: 5 * GRAIN_SECTORS, payload: 40 },     // thin hole between grain 1 and 5
    { lba: 9 * GRAIN_SECTORS, payload: 3000 },
  ]

  const run = (file: string, pos = 0, position = 0) =>
    parseNfcStreamProbe(execFileSync('perl', [script, file, String(pos), String(position)]).toString())

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'nfc-probe-'))
    script = join(dir, 'probe.pl')
    writeFileSync(script, NFC_STREAM_PROBE_SCRIPT)
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('reads the capacity from the header and the position from the last complete grain', () => {
    const file = join(dir, 'full.vmdk')
    writeFileSync(file, buildStream({ capacitySectors, grains, withEnd: true }))
    const r = run(file)
    expect(r).not.toBeNull()
    expect(r!.capacity).toBe(capacitySectors * SECTOR)
    expect(r!.position).toBe(10 * GRAIN_SECTORS * SECTOR) // grain 9 ends at grain 10
    expect(r!.eos).toBe(true)
    expect(r!.size).toBe(statSync(file).size)
  })

  it('reports no end of stream and stops before a half-written grain', () => {
    const full = buildStream({ capacitySectors, grains, withEnd: false })
    // Cut inside the 4th grain marker's payload.
    const cut = full.subarray(0, full.length - 1000)
    const file = join(dir, 'partial.vmdk')
    writeFileSync(file, cut)
    const r = run(file)!
    expect(r.eos).toBe(false)
    expect(r.position).toBe(6 * GRAIN_SECTORS * SECTOR) // grain 5 is the last complete one
    expect(r.pos).toBeLessThan(cut.length)
  })

  it('resumes from a previous offset and lands on the same answer as a fresh parse', () => {
    const full = buildStream({ capacitySectors, grains, withEnd: true })
    const file = join(dir, 'resume.vmdk')
    writeFileSync(file, full.subarray(0, 4 * SECTOR + 100))
    const first = run(file)!
    expect(first.position).toBe(1 * GRAIN_SECTORS * SECTOR)
    writeFileSync(file, full)
    const resumed = run(file, first.pos, first.position)!
    const fresh = run(file)!
    expect(resumed).toEqual(fresh)
    expect(resumed.eos).toBe(true)
  })

  it('reports zero position and no capacity before the header is complete', () => {
    const file = join(dir, 'empty.vmdk')
    writeFileSync(file, Buffer.alloc(100, 0))
    expect(run(file)).toEqual({ size: 100, pos: 0, position: 0, capacity: 0, eos: false })
  })

  it('ignores a file that is not a stream-optimized VMDK', () => {
    const file = join(dir, 'html.vmdk')
    writeFileSync(file, Buffer.from('<html>error</html>'.padEnd(2048, ' ')))
    const r = run(file)!
    expect(r.capacity).toBe(0)
    expect(r.position).toBe(0)
  })
})

const hasQemuImg = spawnSync('qemu-img', ['--version']).status === 0

describe.skipIf(!hasQemuImg)('NFC_STREAM_PROBE_SCRIPT against a qemu-img streamOptimized image', () => {
  let dir: string
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'nfc-probe-qemu-')) })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('walks a real stream to its end and finds the capacity', () => {
    const raw = join(dir, 'src.raw')
    const vmdk = join(dir, 'src.vmdk')
    const script = join(dir, 'probe.pl')
    writeFileSync(script, NFC_STREAM_PROBE_SCRIPT)
    // 8 MiB thin disk: data at the start and around 6 MiB, hole in between.
    const img = Buffer.alloc(8 * 1048576, 0)
    for (let i = 0; i < 300 * 1024; i++) img[i] = (i * 7919) & 0xff
    for (let i = 6 * 1048576; i < 6 * 1048576 + 200 * 1024; i++) img[i] = (i * 31) & 0xff
    writeFileSync(raw, img)
    execFileSync('qemu-img', ['convert', '-f', 'raw', '-O', 'vmdk', '-o', 'subformat=streamOptimized', raw, vmdk])
    const r = parseNfcStreamProbe(execFileSync('perl', [script, vmdk, '0', '0']).toString())!
    expect(r.capacity).toBe(8 * 1048576)
    expect(r.eos).toBe(true)
    // Last data lands just past 6.2 MiB, so the position is the end of that grain.
    expect(r.position).toBeGreaterThanOrEqual(6 * 1048576 + 200 * 1024)
    expect(r.position).toBeLessThanOrEqual(8 * 1048576)
    expect(r.size).toBe(readFileSync(vmdk).length)
  })
})
