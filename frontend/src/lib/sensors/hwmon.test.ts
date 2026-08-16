import { describe, it, expect } from 'vitest'

import { parseHwmon, sensorSeverity } from './hwmon'

// Verbatim stdout captured on a bare-metal AMD PVE host: 6 chips, 13 temperature
// sensors, two chips sharing the name `nvme` and two sharing `spd5118`, and a
// k10temp that exposes temp1 and temp3 with no temp2.
const BARE_METAL = `/sys/class/hwmon/hwmon0/name:acpitz
/sys/class/hwmon/hwmon1/name:nvme
/sys/class/hwmon/hwmon2/name:nvme
/sys/class/hwmon/hwmon3/name:k10temp
/sys/class/hwmon/hwmon4/name:spd5118
/sys/class/hwmon/hwmon5/name:spd5118
/sys/class/hwmon/hwmon1/temp1_label:Composite
/sys/class/hwmon/hwmon1/temp2_label:Sensor 1
/sys/class/hwmon/hwmon1/temp3_label:Sensor 2
/sys/class/hwmon/hwmon1/temp4_label:Sensor 3
/sys/class/hwmon/hwmon2/temp1_label:Composite
/sys/class/hwmon/hwmon2/temp2_label:Sensor 1
/sys/class/hwmon/hwmon2/temp3_label:Sensor 2
/sys/class/hwmon/hwmon2/temp4_label:Sensor 3
/sys/class/hwmon/hwmon3/temp1_label:Tctl
/sys/class/hwmon/hwmon3/temp3_label:Tccd1
/sys/class/hwmon/hwmon0/temp1_input:59600
/sys/class/hwmon/hwmon1/temp1_input:39850
/sys/class/hwmon/hwmon1/temp2_input:46850
/sys/class/hwmon/hwmon1/temp3_input:41850
/sys/class/hwmon/hwmon1/temp4_input:39850
/sys/class/hwmon/hwmon2/temp1_input:40850
/sys/class/hwmon/hwmon2/temp2_input:46850
/sys/class/hwmon/hwmon2/temp3_input:41850
/sys/class/hwmon/hwmon2/temp4_input:40850
/sys/class/hwmon/hwmon3/temp1_input:59625
/sys/class/hwmon/hwmon3/temp3_input:46250
/sys/class/hwmon/hwmon4/temp1_input:40250
/sys/class/hwmon/hwmon5/temp1_input:39750`

describe('parseHwmon', () => {
  it('reads every sensor of a bare-metal host', () => {
    const { readings } = parseHwmon(BARE_METAL)

    expect(readings).toHaveLength(13)
  })

  it('converts millidegrees to one decimal', () => {
    const { readings } = parseHwmon(BARE_METAL)
    const tctl = readings.find(r => r.label === 'Tctl')

    expect(tctl).toMatchObject({ id: 'hwmon3', chip: 'k10temp', celsius: 59.6, role: 'cpu' })
  })

  it('falls back to the sysfs key when a chip publishes no label', () => {
    const { readings } = parseHwmon(BARE_METAL)
    const acpitz = readings.find(r => r.chip === 'acpitz')

    expect(acpitz).toMatchObject({ label: 'temp1', celsius: 59.6, role: 'board' })
  })

  it('keeps two chips of the same name apart by hwmon id', () => {
    const { readings } = parseHwmon(BARE_METAL)
    const composites = readings.filter(r => r.label === 'Composite')

    expect(composites.map(r => r.id)).toEqual(['hwmon1', 'hwmon2'])
    expect(composites.map(r => r.celsius)).toEqual([39.9, 40.9])
  })

  it('pairs a label with its own sensor when the numbering has gaps', () => {
    const { readings } = parseHwmon(BARE_METAL)
    const cpu = readings.filter(r => r.role === 'cpu')

    // k10temp exposes temp1 and temp3 with no temp2 in between.
    expect(cpu.map(r => [r.label, r.celsius])).toEqual([['Tccd1', 46.3], ['Tctl', 59.6]])
  })

  it('aggregates by role because a populated host reports one sensor per DIMM', () => {
    const { byRole } = parseHwmon(BARE_METAL)

    expect(byRole).toEqual([
      { role: 'cpu', max: 59.6, count: 2 },
      { role: 'board', max: 59.6, count: 1 },
      { role: 'memory', max: 40.3, count: 2 },
      { role: 'disk', max: 46.9, count: 8 },
    ])
  })

  it('reports the hottest sensor', () => {
    const { hottest } = parseHwmon(BARE_METAL)

    expect(hottest).toMatchObject({ chip: 'k10temp', label: 'Tctl', celsius: 59.6 })
  })

  it('leaves an unlisted chip as other rather than guessing its role', () => {
    const { readings } = parseHwmon(
      ['/sys/class/hwmon/hwmon0/name:nct6798', '/sys/class/hwmon/hwmon0/temp5_input:38000'].join('\n')
    )

    expect(readings).toEqual([
      { id: 'hwmon0', chip: 'nct6798', label: 'temp5', celsius: 38, role: 'other' },
    ])
  })

  it('returns nothing on a node with no thermal sensor', () => {
    // A virtualized PVE node exposes no hwmon temperature at all, so the
    // command succeeds with empty stdout rather than failing.
    expect(parseHwmon('')).toEqual({ readings: [], byRole: [], hottest: null })
    expect(parseHwmon('   \n  ')).toEqual({ readings: [], byRole: [], hottest: null })
  })

  it('drops placeholder readings from absent or unsupported sensors', () => {
    const { readings } = parseHwmon(
      [
        '/sys/class/hwmon/hwmon0/name:nvme',
        '/sys/class/hwmon/hwmon0/temp1_input:0',
        '/sys/class/hwmon/hwmon0/temp2_input:-273200',
        '/sys/class/hwmon/hwmon0/temp3_input:200000',
        '/sys/class/hwmon/hwmon0/temp4_input:44000',
      ].join('\n')
    )

    expect(readings.map(r => r.celsius)).toEqual([44])
  })

  it('ignores a sensor whose chip name is missing', () => {
    const { readings } = parseHwmon('/sys/class/hwmon/hwmon9/temp1_input:44000')

    expect(readings).toEqual([])
  })

  it('ignores a non-numeric body from a failed sysfs read', () => {
    const { readings } = parseHwmon(
      [
        '/sys/class/hwmon/hwmon0/name:k10temp',
        '/sys/class/hwmon/hwmon0/temp1_input:',
        '/sys/class/hwmon/hwmon0/temp2_input:Invalid argument',
      ].join('\n')
    )

    expect(readings).toEqual([])
  })

  it('ignores lines that are not hwmon temperature entries', () => {
    const { readings } = parseHwmon(
      [
        'grep: /sys/class/hwmon/hwmon0/temp1_label: No such file or directory',
        '/sys/class/hwmon/hwmon0/name:k10temp',
        '/sys/class/hwmon/hwmon0/in0_input:1200',
        '/sys/class/hwmon/hwmon0/fan1_input:2400',
        '/sys/class/hwmon/hwmon0/temp1_input:51000',
      ].join('\n')
    )

    expect(readings).toEqual([
      { id: 'hwmon0', chip: 'k10temp', label: 'temp1', celsius: 51, role: 'cpu' },
    ])
  })
})

describe('sensorSeverity', () => {
  it('holds a CPU to a higher bar than a disk', () => {
    // 65 C is unremarkable on a CPU die and alarming on a spinning disk.
    expect(sensorSeverity('cpu', 65)).toBe('ok')
    expect(sensorSeverity('disk', 65)).toBe('crit')
  })

  it('classifies each role against its own thresholds', () => {
    expect(sensorSeverity('cpu', 79.9)).toBe('ok')
    expect(sensorSeverity('cpu', 80)).toBe('warn')
    expect(sensorSeverity('cpu', 90)).toBe('crit')
    expect(sensorSeverity('memory', 75)).toBe('warn')
    expect(sensorSeverity('disk', 50)).toBe('warn')
    expect(sensorSeverity('board', 90)).toBe('crit')
  })

  it('treats an unclassified chip like a CPU rather than a disk', () => {
    // Erring the other way would paint every super-I/O board sensor red.
    expect(sensorSeverity('other', 65)).toBe('ok')
  })

  it('reads the bare-metal host as healthy throughout', () => {
    const { byRole } = parseHwmon(BARE_METAL)

    expect(byRole.map(r => sensorSeverity(r.role, r.max))).toEqual(['ok', 'ok', 'ok', 'ok'])
  })
})
