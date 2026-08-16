/**
 * Parse the kernel hwmon tree into node temperature readings.
 *
 * Proxmox exposes no temperature anywhere in its API (the node API has no
 * `sensors` sub-path), so this reads sysfs over SSH instead. sysfs is what
 * lm-sensors itself reads, and neither lm-sensors nor ipmitool is installed on
 * a stock PVE node (verified on PVE 9.1.1 and on a bare-metal PVE host), so
 * going through sysfs directly is the only option that needs nothing installed.
 *
 * Expected input is the raw stdout of a single command:
 *
 *   grep -H . /sys/class/hwmon/hwmon*\/name \
 *             /sys/class/hwmon/hwmon*\/temp*_label \
 *             /sys/class/hwmon/hwmon*\/temp*_input
 *
 * which emits `path:value` lines, measured on a bare-metal AMD PVE host:
 *
 *   /sys/class/hwmon/hwmon3/name:k10temp
 *   /sys/class/hwmon/hwmon3/temp1_label:Tctl
 *   /sys/class/hwmon/hwmon3/temp1_input:59750
 *
 * `_input` is in millidegrees Celsius. A sensor may have no `_label`, in which
 * case the sysfs key (`temp1`) is the only name it has.
 */

export type SensorRole = 'cpu' | 'board' | 'memory' | 'disk' | 'other'

export type SensorReading = {
  /** hwmon directory, e.g. "hwmon3". Distinguishes two chips of the same name. */
  id: string
  /** Chip name from `name`, e.g. "k10temp", "nvme", "spd5118". */
  chip: string
  /** `_label` when the chip provides one, else the sysfs key such as "temp1". */
  label: string
  celsius: number
  role: SensorRole
}

export type SensorRoleSummary = {
  role: SensorRole
  /** Hottest reading for this role. Roles aggregate because a populated server
   *  reports one sensor per DIMM and per NVMe namespace; listing them raw is
   *  unreadable (13 sensors across 6 chips on a single mid-range host). */
  max: number
  count: number
}

export type NodeSensors = {
  readings: SensorReading[]
  byRole: SensorRoleSummary[]
  hottest: SensorReading | null
}

/**
 * Explicit chip-to-role mapping. Anything unlisted stays 'other' and keeps its
 * chip name on screen: super-I/O chips (nct6798, it8686, ...) expose a dozen
 * board-specific sensors whose meaning varies per motherboard, so guessing a
 * role for them would invent information we do not have.
 */
const ROLE_BY_CHIP: Record<string, SensorRole> = {
  k10temp: 'cpu',
  zenpower: 'cpu',
  coretemp: 'cpu',
  cpu_thermal: 'cpu',
  acpitz: 'board',
  nvme: 'disk',
  drivetemp: 'disk',
  spd5118: 'memory',
  jc42: 'memory',
}

const ROLE_ORDER: SensorRole[] = ['cpu', 'board', 'memory', 'disk', 'other']

/**
 * A sensor that is absent, disconnected or unsupported reports a placeholder
 * rather than an error: 0 on virtualized disks, and large negatives on some
 * super-I/O chips. Bound the range so those never reach the UI as a reading.
 */
const MIN_PLAUSIBLE_CELSIUS = 1
const MAX_PLAUSIBLE_CELSIUS = 150

export type SensorSeverity = 'ok' | 'warn' | 'crit'

/**
 * What counts as hot depends on what is being measured: an NVMe throttles in
 * the seventies and a spinning disk is specified to 60, while a CPU die is
 * still fine at 80. One shared threshold would either cry wolf on the CPU or
 * stay silent on a cooking disk, so classify per role.
 */
const THRESHOLDS: Record<SensorRole, { warn: number; crit: number }> = {
  cpu: { warn: 80, crit: 90 },
  board: { warn: 80, crit: 90 },
  memory: { warn: 75, crit: 85 },
  disk: { warn: 50, crit: 60 },
  other: { warn: 80, crit: 90 },
}

export function sensorSeverity(role: SensorRole, celsius: number): SensorSeverity {
  const { warn, crit } = THRESHOLDS[role] ?? THRESHOLDS.other

  if (celsius >= crit) return 'crit'
  if (celsius >= warn) return 'warn'

  return 'ok'
}

const LINE_PATTERN = /^\/sys\/class\/hwmon\/(hwmon\d+)\/([^:]+):(.*)$/

type ParsedLine = { id: string; key: string; value: string }

function parseLine(line: string): ParsedLine | null {
  const match = LINE_PATTERN.exec(line.trim())

  if (!match) return null

  return { id: match[1], key: match[2], value: match[3].trim() }
}

function roleOf(chip: string): SensorRole {
  return ROLE_BY_CHIP[chip] ?? 'other'
}

function summarize(readings: SensorReading[]): SensorRoleSummary[] {
  const byRole = new Map<SensorRole, SensorRoleSummary>()

  for (const reading of readings) {
    const current = byRole.get(reading.role)

    if (!current) {
      byRole.set(reading.role, { role: reading.role, max: reading.celsius, count: 1 })
      continue
    }

    current.count += 1
    if (reading.celsius > current.max) current.max = reading.celsius
  }

  return ROLE_ORDER.filter(role => byRole.has(role)).map(role => byRole.get(role)!)
}

export function parseHwmon(stdout: string): NodeSensors {
  const empty: NodeSensors = { readings: [], byRole: [], hottest: null }

  if (!stdout || stdout.trim() === '') return empty

  const chips = new Map<string, string>()
  const labels = new Map<string, string>()
  const inputs = new Map<string, number>()

  for (const line of stdout.replace(/\r\n?/g, '\n').split('\n')) {
    const parsed = parseLine(line)

    if (!parsed) continue

    const { id, key, value } = parsed

    if (key === 'name') {
      if (value) chips.set(id, value)
      continue
    }

    const labelKey = /^(temp\d+)_label$/.exec(key)

    if (labelKey) {
      if (value) labels.set(`${id}/${labelKey[1]}`, value)
      continue
    }

    const inputKey = /^(temp\d+)_input$/.exec(key)

    if (inputKey) {
      const millidegrees = Number(value)

      // A sysfs read can fail mid-collection and leave a non-numeric body.
      if (Number.isFinite(millidegrees)) inputs.set(`${id}/${inputKey[1]}`, millidegrees)
    }
  }

  const readings: SensorReading[] = []

  for (const [sensorKey, millidegrees] of inputs) {
    const [id, tempKey] = sensorKey.split('/')
    const chip = chips.get(id)

    // No chip name means we cannot say what the sensor measures. Drop it
    // rather than show a bare number with no provenance.
    if (!chip) continue

    const celsius = Math.round(millidegrees / 100) / 10

    if (celsius < MIN_PLAUSIBLE_CELSIUS || celsius > MAX_PLAUSIBLE_CELSIUS) continue

    readings.push({
      id,
      chip,
      label: labels.get(sensorKey) ?? tempKey,
      celsius,
      role: roleOf(chip),
    })
  }

  if (readings.length === 0) return empty

  readings.sort((a, b) => {
    const byRole = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)

    if (byRole !== 0) return byRole
    if (a.id !== b.id) return a.id.localeCompare(b.id, undefined, { numeric: true })

    return a.label.localeCompare(b.label, undefined, { numeric: true })
  })

  const hottest = readings.reduce((worst, r) => (r.celsius > worst.celsius ? r : worst), readings[0])

  return { readings, byRole: summarize(readings), hottest }
}
