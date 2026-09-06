import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  TAG_PALETTE,
  hashStringToInt,
  tagColor,
  sanitizeTag,
  filterTagInput,
  resolveVmPowerAction,
  vmIconOpacity,
  safeJson,
  asArray,
  parseTags,
  pct,
  cpuPct,
  formatBps,
  formatUptime,
  parseMarkdown,
  parseNodeId,
  parseVmId,
  proxmoxWebUiOrigin,
  proxmoxNodeWebUiOrigin,
  getMetricIcon,
  pickNumber,
  buildSeriesFromRrd,
  fetchDetails,
  passthroughLabel,
  parseLxcFeatures,
  buildLxcFeatures,
  toggleLxcFeature,
  canEditLxcFeature,
  humanizePveError,
  optionSaveBody,
  guestNameOptionEdit,
  formatRrdTick,
  formatRrdTooltipTs,
  rrdTimeframeFromSeries,
  parseMachineType,
  buildMachineType,
  formatMachineType,
  machineTypeRow,
  parseDiskFormat,
  HOTPLUG_DEVICES,
  hotplugDevice,
} from './helpers'

/* ------------------------------------------------------------------ */
/* Tag colors                                                          */
/* ------------------------------------------------------------------ */

describe('hashStringToInt', () => {
  it('returns a non-negative integer', () => {
    expect(hashStringToInt('test')).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(hashStringToInt('test'))).toBe(true)
  })

  it('is deterministic', () => {
    expect(hashStringToInt('hello')).toBe(hashStringToInt('hello'))
  })

  it('produces different values for different strings', () => {
    expect(hashStringToInt('a')).not.toBe(hashStringToInt('b'))
  })

  it('returns 0 for empty string', () => {
    expect(hashStringToInt('')).toBe(0)
  })
})

describe('tagColor', () => {
  it('returns a color from TAG_PALETTE', () => {
    expect(TAG_PALETTE).toContain(tagColor('prod'))
  })

  it('is deterministic', () => {
    expect(tagColor('web')).toBe(tagColor('web'))
  })

  it('is case-insensitive', () => {
    expect(tagColor('Prod')).toBe(tagColor('prod'))
    expect(tagColor('PROD')).toBe(tagColor('prod'))
  })

  it('returns a valid hex color', () => {
    expect(tagColor('test')).toMatch(/^#[0-9a-f]{6}$/)
  })
})

/* ------------------------------------------------------------------ */
/* Tag sanitization (Proxmox pve-tag format)                           */
/* ------------------------------------------------------------------ */

describe('sanitizeTag', () => {
  it('keeps dots so IP addresses are valid tags (discussion #408)', () => {
    expect(sanitizeTag('192.168.1.50')).toBe('192.168.1.50')
  })

  it('keeps plus and underscore (pve-tag format)', () => {
    expect(sanitizeTag('build_v2+rc1')).toBe('build_v2+rc1')
  })

  it('lowercases and hyphenates whitespace', () => {
    expect(sanitizeTag('  Prod Web  ')).toBe('prod-web')
  })

  it('strips characters outside the pve-tag set', () => {
    expect(sanitizeTag('héllo/wörld!')).toBe('hllowrld')
  })

  it('collapses repeated hyphens', () => {
    expect(sanitizeTag('a---b')).toBe('a-b')
  })

  it('trims leading/trailing dots and hyphens', () => {
    expect(sanitizeTag('.foo.')).toBe('foo')
    expect(sanitizeTag('-bar-')).toBe('bar')
  })

  it('returns empty string for input with no valid characters', () => {
    expect(sanitizeTag('   ')).toBe('')
    expect(sanitizeTag('@@@')).toBe('')
  })
})

describe('filterTagInput', () => {
  it('keeps dots while typing', () => {
    expect(filterTagInput('10.0.0.1')).toBe('10.0.0.1')
  })

  it('preserves whitespace (hyphenated only on save)', () => {
    expect(filterTagInput('prod web')).toBe('prod web')
  })

  it('lowercases and drops invalid characters', () => {
    expect(filterTagInput('Web/Tier#1')).toBe('webtier1')
  })
})

/* ------------------------------------------------------------------ */
/* resolveVmPowerAction                                                */
/* ------------------------------------------------------------------ */

describe('resolveVmPowerAction', () => {
  it('maps start -> resume for a paused VM (discussion #408)', () => {
    expect(resolveVmPowerAction('start', 'paused')).toBe('resume')
  })

  it('leaves start unchanged for a stopped VM', () => {
    expect(resolveVmPowerAction('start', 'stopped')).toBe('start')
  })

  it('leaves start unchanged when status is unknown', () => {
    expect(resolveVmPowerAction('start')).toBe('start')
  })

  it('maps pause -> suspend regardless of status', () => {
    expect(resolveVmPowerAction('pause', 'running')).toBe('suspend')
    expect(resolveVmPowerAction('pause', 'paused')).toBe('suspend')
  })

  it('passes resume through unchanged', () => {
    expect(resolveVmPowerAction('resume', 'paused')).toBe('resume')
  })

  it('passes other actions through unchanged', () => {
    expect(resolveVmPowerAction('shutdown', 'running')).toBe('shutdown')
    expect(resolveVmPowerAction('stop', 'running')).toBe('stop')
    expect(resolveVmPowerAction('reboot', 'running')).toBe('reboot')
    expect(resolveVmPowerAction('hibernate', 'running')).toBe('hibernate')
  })
})

/* ------------------------------------------------------------------ */
/* vmIconOpacity                                                       */
/* ------------------------------------------------------------------ */

describe('vmIconOpacity', () => {
  it('keeps running guests bright', () => {
    expect(vmIconOpacity('running')).toBe(0.9)
  })

  it('fades stopped guests the most', () => {
    expect(vmIconOpacity('stopped')).toBe(0.3)
  })

  it('puts paused guests in between', () => {
    const paused = vmIconOpacity('paused')
    expect(paused).toBeLessThan(vmIconOpacity('running'))
    expect(paused).toBeGreaterThan(vmIconOpacity('stopped'))
  })

  it('treats unknown status as off', () => {
    expect(vmIconOpacity(undefined)).toBe(0.3)
  })

  it('uses the template opacity regardless of status', () => {
    expect(vmIconOpacity('running', true)).toBe(0.5)
    expect(vmIconOpacity('stopped', true)).toBe(0.5)
  })
})

/* ------------------------------------------------------------------ */
/* JSON / Array helpers                                                */
/* ------------------------------------------------------------------ */

describe('safeJson', () => {
  it('unwraps single { data: ... }', () => {
    expect(safeJson({ data: 'value' })).toBe('value')
  })

  it('unwraps nested { data: { data: ... } }', () => {
    expect(safeJson({ data: { data: 42 } })).toBe(42)
  })

  it('returns primitive as-is', () => {
    expect(safeJson('hello')).toBe('hello')
    expect(safeJson(42)).toBe(42)
    expect(safeJson(null)).toBeNull()
  })

  it('returns array as-is (no "data" key)', () => {
    const arr = [1, 2, 3]
    expect(safeJson(arr)).toEqual(arr)
  })

  it('returns object without data key as-is', () => {
    const obj = { name: 'test', value: 1 }
    expect(safeJson(obj)).toEqual(obj)
  })
})

describe('asArray', () => {
  it('returns array input as-is', () => {
    expect(asArray([1, 2])).toEqual([1, 2])
  })

  it('extracts .items from object', () => {
    expect(asArray({ items: [1, 2] })).toEqual([1, 2])
  })

  it('extracts .guests from object', () => {
    expect(asArray({ guests: ['a', 'b'] })).toEqual(['a', 'b'])
  })

  it('returns empty array for null/undefined', () => {
    expect(asArray(null)).toEqual([])
    expect(asArray(undefined)).toEqual([])
  })

  it('returns empty array for primitive', () => {
    expect(asArray('string')).toEqual([])
    expect(asArray(42)).toEqual([])
  })

  it('returns empty array for object without items/guests', () => {
    expect(asArray({ name: 'test' })).toEqual([])
  })
})

describe('parseTags', () => {
  it('splits semicolon-separated tags', () => {
    expect(parseTags('prod;web;critical')).toEqual(['prod', 'web', 'critical'])
  })

  it('splits comma-separated tags', () => {
    expect(parseTags('prod,web,critical')).toEqual(['prod', 'web', 'critical'])
  })

  it('splits mixed separators', () => {
    expect(parseTags('prod;web,critical')).toEqual(['prod', 'web', 'critical'])
  })

  it('trims whitespace', () => {
    expect(parseTags('prod ; web ; critical')).toEqual(['prod', 'web', 'critical'])
  })

  it('filters empty strings', () => {
    expect(parseTags('prod;;web')).toEqual(['prod', 'web'])
    expect(parseTags(';prod;')).toEqual(['prod'])
  })

  it('returns empty array for undefined', () => {
    expect(parseTags(undefined)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseTags('')).toEqual([])
  })

  it('handles single tag', () => {
    expect(parseTags('prod')).toEqual(['prod'])
  })
})

/* ------------------------------------------------------------------ */
/* Utils                                                               */
/* ------------------------------------------------------------------ */

describe('pct', () => {
  it('calculates percentage correctly', () => {
    expect(pct(50, 100)).toBe(50)
    expect(pct(1, 3)).toBe(33)
    expect(pct(2, 3)).toBe(67)
  })

  it('returns 0 for zero max', () => {
    expect(pct(50, 0)).toBe(0)
  })

  it('returns 0 for negative max', () => {
    expect(pct(50, -1)).toBe(0)
  })

  it('returns 100 for used === max', () => {
    expect(pct(100, 100)).toBe(100)
  })

  it('rounds to nearest integer', () => {
    expect(pct(1, 3)).toBe(33)
    expect(pct(2, 3)).toBe(67)
  })
})

describe('cpuPct', () => {
  it('converts fraction to percentage', () => {
    expect(cpuPct(0.5)).toBe(50)
    expect(cpuPct(1)).toBe(100)
    expect(cpuPct(0)).toBe(0)
  })

  it('rounds result', () => {
    expect(cpuPct(0.333)).toBe(33)
    expect(cpuPct(0.667)).toBe(67)
  })

  it('handles null/undefined as 0', () => {
    expect(cpuPct(null)).toBe(0)
    expect(cpuPct(undefined)).toBe(0)
  })

  it('handles string numbers', () => {
    expect(cpuPct('0.5')).toBe(50)
  })

  it('returns 0 for non-finite values', () => {
    expect(cpuPct('not-a-number')).toBe(0)
    expect(cpuPct(Infinity)).toBe(0)
  })
})

describe('formatBps', () => {
  it('returns "0 B/s" for 0', () => {
    expect(formatBps(0)).toBe('0 B/s')
  })

  it('returns "0 B/s" for negative', () => {
    expect(formatBps(-100)).toBe('0 B/s')
  })

  it('returns "0 B/s" for Number.NaN', () => {
    expect(formatBps(Number.NaN)).toBe('0 B/s')
  })

  it('formats bytes/s', () => {
    expect(formatBps(500)).toBe('500 B/s')
  })

  it('formats KB/s', () => {
    expect(formatBps(1024)).toBe('1.0 KB/s')
    expect(formatBps(1536)).toBe('1.5 KB/s')
  })

  it('formats MB/s', () => {
    expect(formatBps(1048576)).toBe('1.0 MB/s')
  })

  it('formats GB/s', () => {
    expect(formatBps(1073741824)).toBe('1.0 GB/s')
  })
})

describe('formatUptime (helpers version)', () => {
  it('returns "—" for 0', () => {
    expect(formatUptime(0)).toBe('—')
  })

  it('returns "—" for negative', () => {
    expect(formatUptime(-10)).toBe('—')
  })

  it('formats seconds as HH:MM:SS', () => {
    expect(formatUptime(3661)).toBe('01:01:01')
  })

  it('formats with days', () => {
    expect(formatUptime(90061)).toBe('1 days 01:01:01')
  })

  it('pads hours, minutes, seconds', () => {
    expect(formatUptime(60)).toBe('00:01:00')
    expect(formatUptime(1)).toBe('00:00:01')
  })
})

/* ------------------------------------------------------------------ */
/* parseMarkdown                                                       */
/* ------------------------------------------------------------------ */

describe('parseMarkdown', () => {
  it('returns empty string for empty input', () => {
    expect(parseMarkdown('')).toBe('')
  })

  it('wraps plain text in <p>', () => {
    expect(parseMarkdown('hello')).toBe('<p>hello</p>')
  })

  it('converts bold **text**', () => {
    expect(parseMarkdown('**bold**')).toContain('<strong>bold</strong>')
  })

  it('converts bold __text__', () => {
    expect(parseMarkdown('__bold__')).toContain('<strong>bold</strong>')
  })

  it('converts italic *text*', () => {
    expect(parseMarkdown('*italic*')).toContain('<em>italic</em>')
  })

  it('converts headings', () => {
    expect(parseMarkdown('# H1')).toContain('<h1>H1</h1>')
    expect(parseMarkdown('## H2')).toContain('<h2>H2</h2>')
    expect(parseMarkdown('### H3')).toContain('<h3>H3</h3>')
  })

  it('converts inline code', () => {
    expect(parseMarkdown('use `code` here')).toContain('<code>code</code>')
  })

  it('converts links', () => {
    const result = parseMarkdown('[text](https://example.com)')
    expect(result).toContain('<a href="https://example.com"')
    expect(result).toContain('target="_blank"')
    expect(result).toContain('>text</a>')
  })

  it('converts horizontal rules', () => {
    expect(parseMarkdown('---')).toContain('<hr />')
  })

  it('converts unordered list items', () => {
    expect(parseMarkdown('- item 1')).toContain('<li>item 1</li>')
    expect(parseMarkdown('* item 1')).toContain('<li>item 1</li>')
  })

  it('preserves existing HTML tags (DOMPurify sanitizes at call site)', () => {
    expect(parseMarkdown('<img src="https://example.com/logo.png"/>')).toContain('<img src="https://example.com/logo.png"/>')
    expect(parseMarkdown('<a href="https://example.com">link</a>')).toContain('<a href="https://example.com">link</a>')
  })

  it('escapes HTML inside code blocks', () => {
    const result = parseMarkdown('```\n<script>alert("xss")</script>\n```')
    expect(result).toContain('&lt;script&gt;')
  })

  it('converts code blocks', () => {
    const result = parseMarkdown('```js\nconsole.log("hi")\n```')
    expect(result).toContain('<pre><code>')
    expect(result).toContain('console.log')
  })

  it('converts blockquotes', () => {
    expect(parseMarkdown('> quote')).toContain('<blockquote>quote</blockquote>')
  })

  it('converts markdown tables', () => {
    const table = '| Field | Value |\n|-------|-------|\n| **Name** | Test |\n| Role | DB |'
    const result = parseMarkdown(table)
    expect(result).toContain('<table>')
    expect(result).toContain('<th>Field</th>')
    expect(result).toContain('<th>Value</th>')
    expect(result).toContain('<td><strong>Name</strong></td>')
    expect(result).toContain('<td>DB</td>')
    expect(result).toContain('</table>')
  })

  it('converts tables with links inside cells', () => {
    const table = '| Link |\n|------|\n| [View](https://example.com) |'
    const result = parseMarkdown(table)
    expect(result).toContain('<table>')
    expect(result).toContain('<a href="https://example.com"')
  })
})

/* ------------------------------------------------------------------ */
/* Parsing IDs                                                         */
/* ------------------------------------------------------------------ */

describe('parseNodeId', () => {
  it('splits connId:node', () => {
    expect(parseNodeId('conn1:pve1')).toEqual({ connId: 'conn1', node: 'pve1' })
  })

  it('handles node name with colons', () => {
    expect(parseNodeId('conn1:node:extra')).toEqual({ connId: 'conn1', node: 'node:extra' })
  })

  it('handles no colon', () => {
    expect(parseNodeId('conn1')).toEqual({ connId: 'conn1', node: '' })
  })
})

describe('parseVmId', () => {
  it('splits connId:node:type:vmid', () => {
    expect(parseVmId('conn1:pve1:qemu:100')).toEqual({
      connId: 'conn1',
      node: 'pve1',
      type: 'qemu',
      vmid: '100',
    })
  })

  it('handles lxc type', () => {
    expect(parseVmId('conn1:pve1:lxc:200')).toEqual({
      connId: 'conn1',
      node: 'pve1',
      type: 'lxc',
      vmid: '200',
    })
  })
})

/* ------------------------------------------------------------------ */
/* proxmoxWebUiOrigin                                                   */
/* ------------------------------------------------------------------ */

describe('proxmoxWebUiOrigin', () => {
  it('returns the origin (scheme + host + port) of a baseUrl', () => {
    expect(proxmoxWebUiOrigin('https://pve.example.com:8006/api2/json')).toBe('https://pve.example.com:8006')
  })

  it('drops any path, query and fragment', () => {
    expect(proxmoxWebUiOrigin('https://10.0.0.5:8006/api2/json/cluster/status?x=1#y')).toBe('https://10.0.0.5:8006')
  })

  it('preserves a non-8006 port (reverse-proxy on default https port)', () => {
    expect(proxmoxWebUiOrigin('https://proxmox.example.com/api2/json')).toBe('https://proxmox.example.com')
  })

  it('returns null for null, undefined or empty input', () => {
    expect(proxmoxWebUiOrigin(null)).toBeNull()
    expect(proxmoxWebUiOrigin(undefined)).toBeNull()
    expect(proxmoxWebUiOrigin('')).toBeNull()
  })

  it('returns null for a malformed baseUrl', () => {
    expect(proxmoxWebUiOrigin('not a url')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* proxmoxNodeWebUiOrigin                                               */
/* ------------------------------------------------------------------ */

describe('proxmoxNodeWebUiOrigin', () => {
  it('swaps the host for the node IP while keeping scheme and port', () => {
    expect(proxmoxNodeWebUiOrigin('https://pve1.example.com:8006/api2/json', '10.0.0.7')).toBe('https://10.0.0.7:8006')
  })

  it('falls back to the connection origin when the node IP is unknown', () => {
    expect(proxmoxNodeWebUiOrigin('https://pve1.example.com:8006', null)).toBe('https://pve1.example.com:8006')
    expect(proxmoxNodeWebUiOrigin('https://pve1.example.com:8006', undefined)).toBe('https://pve1.example.com:8006')
  })

  it('falls back to the connection origin when behind a reverse proxy (internal node IPs unreachable)', () => {
    expect(proxmoxNodeWebUiOrigin('https://proxmox.example.com', '10.0.0.7', true)).toBe('https://proxmox.example.com')
  })

  it('returns null when there is no baseUrl to derive scheme/port from', () => {
    expect(proxmoxNodeWebUiOrigin(null, '10.0.0.7')).toBeNull()
  })

  it('falls back to the connection origin for a malformed baseUrl', () => {
    expect(proxmoxNodeWebUiOrigin('not a url', '10.0.0.7')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* getMetricIcon                                                       */
/* ------------------------------------------------------------------ */

describe('getMetricIcon', () => {
  it('returns CPU icon for cpu-related labels', () => {
    expect(getMetricIcon('CPU')).toBe('ri-cpu-line')
    expect(getMetricIcon('cpu usage')).toBe('ri-cpu-line')
  })

  it('returns memory icon for ram/memory labels', () => {
    expect(getMetricIcon('RAM')).toBe('ri-ram-line')
    expect(getMetricIcon('Memory Usage')).toBe('ri-ram-line')
  })

  it('returns disk icon for storage/disk labels', () => {
    expect(getMetricIcon('Storage')).toBe('ri-hard-drive-2-line')
    expect(getMetricIcon('HD Usage')).toBe('ri-hard-drive-2-line')
    expect(getMetricIcon('Disk I/O')).toBe('ri-hard-drive-2-line')
  })

  it('returns swap icon', () => {
    expect(getMetricIcon('SWAP')).toBe('ri-swap-line')
  })

  it('returns load icon', () => {
    expect(getMetricIcon('Load Average')).toBe('ri-dashboard-3-line')
  })

  it('returns io icon', () => {
    expect(getMetricIcon('IO Wait')).toBe('ri-time-line')
  })

  it('returns default icon for unknown labels', () => {
    expect(getMetricIcon('Unknown')).toBe('ri-bar-chart-line')
    expect(getMetricIcon('Temperature')).toBe('ri-bar-chart-line')
  })
})

/* ------------------------------------------------------------------ */
/* pickNumber                                                          */
/* ------------------------------------------------------------------ */

describe('pickNumber', () => {
  it('returns first finite number found', () => {
    expect(pickNumber({ a: 'nan', b: 42 }, ['a', 'b'])).toBe(42)
  })

  it('returns null when no key has a finite number', () => {
    expect(pickNumber({ a: 'nan', b: undefined }, ['a', 'b'])).toBeNull()
  })

  it('returns null for empty object', () => {
    expect(pickNumber({}, ['a', 'b'])).toBeNull()
  })

  it('returns null for null/undefined input', () => {
    expect(pickNumber(null, ['a'])).toBeNull()
    expect(pickNumber(undefined, ['a'])).toBeNull()
  })

  it('picks first matching key in order', () => {
    expect(pickNumber({ a: 10, b: 20 }, ['a', 'b'])).toBe(10)
  })

  it('skips Infinity and Number.NaN', () => {
    expect(pickNumber({ a: Infinity, b: Number.NaN, c: 5 }, ['a', 'b', 'c'])).toBe(5)
  })

  it('converts string numbers', () => {
    expect(pickNumber({ a: '42' }, ['a'])).toBe(42)
  })
})

/* ------------------------------------------------------------------ */
/* buildSeriesFromRrd                                                  */
/* ------------------------------------------------------------------ */

describe('buildSeriesFromRrd', () => {
  it('returns empty array for empty input', () => {
    expect(buildSeriesFromRrd([])).toEqual([])
  })

  it('skips entries without time', () => {
    expect(buildSeriesFromRrd([{ cpu: 0.5 }])).toEqual([])
  })

  it('extracts timestamp and converts to ms', () => {
    const result = buildSeriesFromRrd([{ time: 1700000000, cpu: 0.5 }])
    expect(result).toHaveLength(1)
    expect(result[0].t).toBe(1700000000000)
  })

  it('converts CPU fraction to percentage', () => {
    const result = buildSeriesFromRrd([{ time: 1, cpu: 0.75 }])
    expect(result[0].cpuPct).toBe(75)
  })

  it('clamps CPU percentage to 0-100', () => {
    const result = buildSeriesFromRrd([{ time: 1, cpu: -0.1 }])
    expect(result[0].cpuPct).toBe(0)
  })

  it('handles mem as fraction', () => {
    const result = buildSeriesFromRrd([{ time: 1, mem: 0.8 }])
    expect(result[0].ramPct).toBe(80)
  })

  it('handles mem as absolute with maxmem', () => {
    const result = buildSeriesFromRrd([{ time: 1, mem: 4096, maxmem: 8192 }])
    expect(result[0].ramPct).toBe(50)
  })

  it('uses provided maxMem parameter', () => {
    const result = buildSeriesFromRrd([{ time: 1, mem: 2048 }], 4096)
    expect(result[0].ramPct).toBe(50)
  })

  it('sorts output by timestamp', () => {
    const result = buildSeriesFromRrd([
      { time: 3, cpu: 0.1 },
      { time: 1, cpu: 0.2 },
      { time: 2, cpu: 0.3 },
    ])
    expect(result.map(p => p.t)).toEqual([1000, 2000, 3000])
  })

  it('extracts network and disk metrics', () => {
    const result = buildSeriesFromRrd([{ time: 1, netin: 1000, netout: 2000, diskread: 500, diskwrite: 300 }])
    expect(result[0].netInBps).toBe(1000)
    expect(result[0].netOutBps).toBe(2000)
    expect(result[0].diskReadBps).toBe(500)
    expect(result[0].diskWriteBps).toBe(300)
  })

  it('extracts loadavg', () => {
    const result = buildSeriesFromRrd([{ time: 1, loadavg: 2.5 }])
    expect(result[0].loadAvg).toBe(2.5)
  })
})

/* ------------------------------------------------------------------ */
/* fetchDetails — cluster pivot tags allVms with isCluster (issue #381) */
/* ------------------------------------------------------------------ */

describe('fetchDetails — cluster allVms isCluster', () => {
  const connId = 'conn1'

  const jsonRes = (body: any, ok = true) => ({ ok, json: async () => body }) as Response

  // Route the 5 parallel cluster-pivot fetches by URL. Only the node list
  // varies between tests; the single guest lives on a multi-node cluster.
  function stubFetch(nodes: any[]) {
    vi.stubGlobal('fetch', vi.fn((input: any) => {
      const url = String(input)
      if (url.includes('/nodes')) return Promise.resolve(jsonRes({ data: nodes }))
      if (url.includes('/resources')) return Promise.resolve(jsonRes({ data: [
        { node: 'pve-2-2', vmid: 20004, type: 'qemu', name: 'RDSLic02-W2022', status: 'running' },
      ] }))
      if (url.includes('/ceph/status')) return Promise.resolve(jsonRes({ data: { health: 'HEALTH_OK' } }))
      if (url.includes('/storage')) return Promise.resolve(jsonRes({ data: [] }))
      return Promise.resolve(jsonRes({ data: { name: 'PVE-2' } })) // bare /connections/:id
    }))
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('flags allVms entries as isCluster on a multi-node cluster', async () => {
    stubFetch([
      { node: 'pve-2-1', status: 'online' },
      { node: 'pve-2-2', status: 'online' },
    ])

    const payload = await fetchDetails({ type: 'cluster', id: connId } as any)

    expect(payload?.allVms).toHaveLength(1)
    expect(payload?.allVms?.[0].isCluster).toBe(true)
  })

  it('leaves isCluster false for a single-node (standalone) connection', async () => {
    stubFetch([{ node: 'pve-2-1', status: 'online' }])

    const payload = await fetchDetails({ type: 'cluster', id: connId } as any)

    expect(payload?.allVms?.[0].isCluster).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* fetchDetails — section/network selections have no generic details   */
/* ------------------------------------------------------------------ */

describe('fetchDetails — section selections return null (no generic CPU/RAM panel)', () => {
  // net-bridge is a host-bridge selection (#490); like the other net-*/section
  // types it must NOT fall through to the generic 'UNKNOWN' details payload.
  it.each([
    'root', 'storage-root', 'network-root', 'backup-root', 'migration-root',
    'net-conn', 'net-node', 'net-vlan', 'net-bridge', 'tvnet',
    'storage-cluster', 'storage-node',
  ])('returns null for %s', async (type) => {
    expect(await fetchDetails({ type, id: 'x' } as any)).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* RRD time-axis formatting (issue #474)                              */
/* ------------------------------------------------------------------ */

const RRD_TS = Date.UTC(2026, 5, 15, 10, 30) // 2026-06-15 10:30 UTC
const rrdDate = new Date(RRD_TS)

describe('formatRrdTick', () => {
  it('shows time only for intraday timeframes (hour, day)', () => {
    const expected = rrdDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    expect(formatRrdTick(RRD_TS, 'hour')).toBe(expected)
    expect(formatRrdTick(RRD_TS, 'day')).toBe(expected)
  })

  it('shows a day/month date for multi-day timeframes (week, month)', () => {
    const expected = rrdDate.toLocaleDateString([], { day: '2-digit', month: '2-digit' })
    expect(formatRrdTick(RRD_TS, 'week')).toBe(expected)
    expect(formatRrdTick(RRD_TS, 'month')).toBe(expected)
  })

  it('shows a short month for the year timeframe', () => {
    expect(formatRrdTick(RRD_TS, 'year')).toBe(rrdDate.toLocaleDateString([], { month: 'short' }))
  })

  it('renders a different label for week than for hour (date is added)', () => {
    expect(formatRrdTick(RRD_TS, 'week')).not.toBe(formatRrdTick(RRD_TS, 'hour'))
  })
})

describe('formatRrdTooltipTs', () => {
  it('shows time only for intraday timeframes (hour, day)', () => {
    const expected = rrdDate.toLocaleTimeString()
    expect(formatRrdTooltipTs(RRD_TS, 'hour')).toBe(expected)
    expect(formatRrdTooltipTs(RRD_TS, 'day')).toBe(expected)
  })

  it('prefixes the date for timeframes wider than a day', () => {
    const datePart = rrdDate.toLocaleDateString([], { day: '2-digit', month: '2-digit' })
    const timePart = rrdDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    expect(formatRrdTooltipTs(RRD_TS, 'week')).toBe(`${datePart} ${timePart}`)
    expect(formatRrdTooltipTs(RRD_TS, 'month')).toContain(datePart)
    expect(formatRrdTooltipTs(RRD_TS, 'year')).toContain(datePart)
  })
})

describe('rrdTimeframeFromSeries', () => {
  const DAY = 86_400_000
  const pt = (t: number) => ({ t } as any)

  it('defaults to hour for missing, empty or single-point series', () => {
    expect(rrdTimeframeFromSeries(undefined)).toBe('hour')
    expect(rrdTimeframeFromSeries([])).toBe('hour')
    expect(rrdTimeframeFromSeries([pt(0)])).toBe('hour')
  })

  it('returns hour for an intraday span (<= 2 days)', () => {
    expect(rrdTimeframeFromSeries([pt(0), pt(DAY)])).toBe('hour')
    expect(rrdTimeframeFromSeries([pt(0), pt(2 * DAY)])).toBe('hour')
  })

  it('returns week for spans of several days up to ~60 days', () => {
    expect(rrdTimeframeFromSeries([pt(0), pt(7 * DAY)])).toBe('week')
    expect(rrdTimeframeFromSeries([pt(0), pt(30 * DAY)])).toBe('week')
  })

  it('returns year for very long spans', () => {
    expect(rrdTimeframeFromSeries([pt(0), pt(365 * DAY)])).toBe('year')
  })

  it('falls back to hour when timestamps are not finite', () => {
    expect(rrdTimeframeFromSeries([pt(NaN), pt(NaN)])).toBe('hour')
    expect(rrdTimeframeFromSeries([{ t: 'x' } as any, { t: 'y' } as any])).toBe('hour')
  })
})

/* ------------------------------------------------------------------ */
/* QEMU machine type                                                   */
/* ------------------------------------------------------------------ */

describe('parseMachineType', () => {
  it('treats an unset machine as the i440fx family', () => {
    expect(parseMachineType(undefined)).toEqual({ family: 'pc', type: '', extras: [] })
    expect(parseMachineType('')).toEqual({ family: 'pc', type: '', extras: [] })
  })

  it('recognises the bare families', () => {
    expect(parseMachineType('pc').family).toBe('pc')
    expect(parseMachineType('q35').family).toBe('q35')
  })

  it('recognises pinned versions, and does not mistake pc-q35 for i440fx', () => {
    expect(parseMachineType('pc-i440fx-9.2+pve1').family).toBe('pc')
    expect(parseMachineType('pc-i440fx-8.1.pxe').family).toBe('pc')
    expect(parseMachineType('pc-q35-8.1').family).toBe('q35')
    expect(parseMachineType('pc-q35-9.2+pve1').family).toBe('q35')
  })

  it('splits the property string, with or without the explicit type= key', () => {
    expect(parseMachineType('q35,viommu=intel')).toEqual({
      family: 'q35', type: 'q35', extras: ['viommu=intel'],
    })
    expect(parseMachineType('type=q35,viommu=intel,aw-bits=48')).toEqual({
      family: 'q35', type: 'q35', extras: ['viommu=intel', 'aw-bits=48'],
    })
    expect(parseMachineType('pc-i440fx-9.2+pve1,enable-s3=1')).toEqual({
      family: 'pc', type: 'pc-i440fx-9.2+pve1', extras: ['enable-s3=1'],
    })
  })

  it('flags an unknown family instead of silently claiming i440fx', () => {
    expect(parseMachineType('virt').family).toBe('other')
    expect(parseMachineType('virt-8.1').family).toBe('other')
  })
})

describe('buildMachineType', () => {
  it('spells the i440fx machine "pc" — "i440fx" is rejected by PVE', () => {
    expect(buildMachineType('', 'pc')).toBe('pc')
    expect(buildMachineType('q35', 'pc')).toBe('pc')
  })

  it('switches to q35', () => {
    expect(buildMachineType('', 'q35')).toBe('q35')
    expect(buildMachineType('pc', 'q35')).toBe('q35')
  })

  it('keeps a pinned version when the family is unchanged', () => {
    expect(buildMachineType('pc-i440fx-9.2+pve1', 'pc')).toBe('pc-i440fx-9.2+pve1')
    expect(buildMachineType('pc-q35-8.1', 'q35')).toBe('pc-q35-8.1')
  })

  it('drops the version pin when switching family, since pins are family-specific', () => {
    expect(buildMachineType('pc-i440fx-9.2+pve1', 'q35')).toBe('q35')
    expect(buildMachineType('pc-q35-8.1', 'pc')).toBe('pc')
  })

  it('preserves the other property-string keys instead of wiping them', () => {
    expect(buildMachineType('q35,viommu=intel', 'pc')).toBe('pc,viommu=intel')
    expect(buildMachineType('type=q35,viommu=intel,aw-bits=48', 'q35')).toBe('q35,viommu=intel,aw-bits=48')
    expect(buildMachineType('pc,enable-s3=1,enable-s4=0', 'q35')).toBe('q35,enable-s3=1,enable-s4=0')
  })

  it('overwrites an unrecognised family with the requested one', () => {
    expect(buildMachineType('virt', 'q35')).toBe('q35')
  })

  it('only ever emits a type PVE accepts', () => {
    // Verbatim from qemu-server PVE/QemuServer/Machine.pm $machine_fmt{type}{pattern}.
    // This is the check that rejected `machine=i440fx` and produced issue #657.
    const PVE_MACHINE_TYPE = /^(pc|pc(-i440fx)?-\d+(\.\d+)+(\+pve\d+)?(\.pxe)?|q35|pc-q35-\d+(\.\d+)+(\+pve\d+)?(\.pxe)?|virt(?:-\d+(\.\d+)+)?(\+pve\d+)?)$/
    const currents = ['', 'pc', 'q35', 'pc-i440fx-9.2+pve1', 'pc-q35-8.1', 'q35,viommu=intel', 'type=pc,enable-s3=1', 'virt']

    for (const current of currents) {
      for (const family of ['pc', 'q35'] as const) {
        const emitted = buildMachineType(current, family)
        expect(emitted.split(',')[0]).toMatch(PVE_MACHINE_TYPE)
      }
    }
  })
})

describe('formatMachineType', () => {
  it('names the default machine so the row is readable', () => {
    expect(formatMachineType('')).toBe('pc (i440fx)')
    expect(formatMachineType(undefined)).toBe('pc (i440fx)')
    expect(formatMachineType('pc')).toBe('pc (i440fx)')
  })

  it('shows the pinned version and the extra keys verbatim', () => {
    expect(formatMachineType('q35')).toBe('q35')
    expect(formatMachineType('pc-i440fx-9.2+pve1')).toBe('pc-i440fx-9.2+pve1')
    expect(formatMachineType('type=q35,viommu=intel')).toBe('q35, viommu=intel')
  })
})

describe('machineTypeRow', () => {
  it('offers pc and q35, and preselects i440fx when the VM has no machine key', () => {
    const row = machineTypeRow('')

    expect(row.value).toBe('pc (i440fx)')
    expect(row.editValue).toBe('pc')
    expect(row.options).toEqual([
      { value: 'pc', label: 'pc (i440fx)' },
      { value: 'q35', label: 'q35' },
    ])
  })

  it('preselects an option that actually exists, so the Select is never blank', () => {
    for (const raw of ['', 'pc', 'q35', 'pc-i440fx-9.2+pve1', 'pc-q35-8.1', 'q35,viommu=intel', 'virt']) {
      const row = machineTypeRow(raw)

      expect(row.options.map(o => o.value)).toContain(row.editValue)
    }
  })

  it('keeps the pinned version selectable instead of silently unpinning it', () => {
    const row = machineTypeRow('pc-i440fx-9.2+pve1')

    expect(row.editValue).toBe('pc-i440fx-9.2+pve1')
    expect(row.options).toEqual([
      { value: 'pc-i440fx-9.2+pve1', label: 'pc-i440fx-9.2+pve1' },
      { value: 'q35', label: 'q35' },
    ])
  })

  it('carries the other property-string keys into both options', () => {
    const row = machineTypeRow('q35,viommu=intel')

    expect(row.value).toBe('q35, viommu=intel')
    expect(row.editValue).toBe('q35,viommu=intel')
    expect(row.options.map(o => o.value)).toEqual(['pc,viommu=intel', 'q35,viommu=intel'])
  })

  it('adds an entry for an unrecognised family rather than dropping the VM into a blank Select', () => {
    const row = machineTypeRow('virt')

    expect(row.editValue).toBe('virt')
    expect(row.options).toHaveLength(3)
    expect(row.options[2]).toEqual({ value: 'virt', label: 'virt' })
  })
})

/* ------------------------------------------------------------------ */
/* Disk image format (issue #735)                                     */
/* ------------------------------------------------------------------ */

describe('parseDiskFormat', () => {
  it('reads the format from the volume name suffix when PVE omits format=', () => {
    // The exact line reported in issue #735 (PVE 9 LVM storage, qcow2 volumes).
    expect(parseDiskFormat('FC-LAB01:vm-500-disk-0.qcow2,size=10G')).toBe('qcow2')
  })

  it('reads the suffix on a file-based volume stored under the VMID directory', () => {
    expect(parseDiskFormat('local:100/vm-100-disk-0.qcow2,size=32G')).toBe('qcow2')
    expect(parseDiskFormat('local:100/vm-100-disk-1.raw,size=8G')).toBe('raw')
    expect(parseDiskFormat('local:100/vm-100-disk-2.vmdk,size=8G')).toBe('vmdk')
  })

  it('keeps an explicit format= property over the suffix', () => {
    expect(parseDiskFormat('local:100/vm-100-disk-0.raw,format=qcow2,size=8G')).toBe('qcow2')
    expect(parseDiskFormat('nas:100/vm-100-disk-0.qcow2,format=raw')).toBe('raw')
  })

  it('reports raw for block storages, whose volumes carry no suffix', () => {
    expect(parseDiskFormat('local-lvm:vm-100-disk-0,size=32G')).toBe('raw')
    expect(parseDiskFormat('ceph-pool:vm-100-disk-0,size=32G')).toBe('raw')
    expect(parseDiskFormat('local-zfs:vm-100-disk-0,size=32G')).toBe('raw')
  })

  it('reports subvol for container subvolumes, suffixed or not', () => {
    expect(parseDiskFormat('local-zfs:subvol-100-disk-0,size=8G')).toBe('subvol')
    expect(parseDiskFormat('local-btrfs:100/subvol-100-disk-0.subvol,size=8G')).toBe('subvol')
  })

  it('ignores dots in the storage ID', () => {
    expect(parseDiskFormat('nas.lab.local:vm-100-disk-0,size=8G')).toBe('raw')
    expect(parseDiskFormat('nas.lab.local:100/vm-100-disk-0.qcow2,size=8G')).toBe('qcow2')
  })

  it('falls back to raw on an unknown suffix or a missing value', () => {
    expect(parseDiskFormat('local:100/vm-100-disk-0.tmp,size=8G')).toBe('raw')
    expect(parseDiskFormat('')).toBe('raw')
    expect(parseDiskFormat(undefined)).toBe('raw')
    expect(parseDiskFormat(null)).toBe('raw')
  })
})

/* ------------------------------------------------------------------ */
/* fetchDetails: Hardware disks report the real format (issue #735)   */
/* ------------------------------------------------------------------ */

describe('fetchDetails: disk format on the Hardware tab', () => {
  const jsonRes = (body: any, ok = true) => ({ ok, json: async () => body }) as Response

  function stubFetch(config: Record<string, any>) {
    vi.stubGlobal('fetch', vi.fn((input: any) => {
      const url = String(input)

      if (url.includes('/config')) return Promise.resolve(jsonRes({ data: config }))
      if (url.includes('/status')) return Promise.resolve(jsonRes({ data: {} }))
      if (url.includes('/resources')) return Promise.resolve(jsonRes({ data: [
        { node: 'pve1', vmid: '500', type: 'qemu', name: 'vm500', status: 'running' },
      ] }))
      if (url.includes('/nodes')) return Promise.resolve(jsonRes({ data: [{ node: 'pve1', status: 'online' }] }))

      return Promise.resolve(jsonRes({ data: {} }))
    }))
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('labels a qcow2 volume qcow2, not raw', async () => {
    stubFetch({ name: 'vm500', scsi0: 'FC-LAB01:vm-500-disk-0.qcow2,size=10G' })

    const payload = await fetchDetails({ type: 'vm', id: 'conn1:pve1:qemu:500' } as any)
    const disk = payload?.disksInfo?.find(d => d.id === 'scsi0')

    expect(disk?.format).toBe('qcow2')
  })

  it('still labels a block-storage volume raw and a CDROM cdrom', async () => {
    stubFetch({
      name: 'vm500',
      scsi0: 'local-lvm:vm-500-disk-0,size=10G',
      ide2: 'local:iso/debian-13.iso,media=cdrom,size=600M',
    })

    const payload = await fetchDetails({ type: 'vm', id: 'conn1:pve1:qemu:500' } as any)

    expect(payload?.disksInfo?.find(d => d.id === 'scsi0')?.format).toBe('raw')
    expect(payload?.disksInfo?.find(d => d.id === 'ide2')?.format).toBe('cdrom')
  })

  // The Cloud-Init drive is a media=cdrom entry backed by a real volume, so it
  // reads as a CD-ROM sitting on a block storage unless it is flagged apart.
  it('flags the Cloud-Init drive instead of passing it off as a CD-ROM', async () => {
    stubFetch({ name: 'vm500', ide2: 'CephPool:vm-500-cloudinit,media=cdrom' })

    const payload = await fetchDetails({ type: 'vm', id: 'conn1:pve1:qemu:500' } as any)
    const drive = payload?.disksInfo?.find(d => d.id === 'ide2') as any

    expect(drive?.isCloudInit).toBe(true)
    expect(drive?.storage).toBe('CephPool')
  })

  it('flags a Cloud-Init drive allocated on a file-based storage too', async () => {
    stubFetch({ name: 'vm500', ide2: 'local:500/vm-500-cloudinit.qcow2,media=cdrom' })

    const payload = await fetchDetails({ type: 'vm', id: 'conn1:pve1:qemu:500' } as any)

    expect((payload?.disksInfo?.find(d => d.id === 'ide2') as any)?.isCloudInit).toBe(true)
  })

  it('leaves a real ISO and a physical drive out of the Cloud-Init case', async () => {
    stubFetch({
      name: 'vm500',
      ide0: 'cdrom,media=cdrom',
      ide2: 'local:iso/debian-13.iso,media=cdrom,size=600M',
      scsi0: 'CephPool:vm-500-disk-0,size=10G',
    })

    const payload = await fetchDetails({ type: 'vm', id: 'conn1:pve1:qemu:500' } as any)

    for (const id of ['ide0', 'ide2', 'scsi0']) {
      expect((payload?.disksInfo?.find(d => d.id === id) as any)?.isCloudInit).toBe(false)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Hotplug device vocabulary (shared by the Options row and its dialog) */
/* ------------------------------------------------------------------ */

describe('hotplug device vocabulary', () => {
  it('covers exactly the five devices PVE can hotplug, in PVE order', () => {
    expect(HOTPLUG_DEVICES.map(d => d.key)).toEqual(['disk', 'network', 'usb', 'memory', 'cpu'])
  })

  it('gives every device a label and an icon', () => {
    for (const device of HOTPLUG_DEVICES) {
      expect(device.label, device.key).toBeTruthy()
      expect(device.icon, device.key).toMatch(/^ri-[a-z0-9-]+$/)
    }
  })

  it('looks a device up from what PVE stores, whatever the case or spacing', () => {
    // PVE's `hotplug` value is a comma separated list we split and trim.
    expect(hotplugDevice('memory')?.icon).toBe('ri-ram-line')
    expect(hotplugDevice(' CPU ')?.label).toBe('CPU')
  })

  it('returns undefined for a device it does not know', () => {
    // A future PVE keyword must fall back to the raw string, not crash.
    expect(hotplugDevice('gpu')).toBeUndefined()
    expect(hotplugDevice('')).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ */
/* LXC features property string (#566)                                 */
/* ------------------------------------------------------------------ */

describe('parseLxcFeatures', () => {
  it('reads the boolean toggles and splits the mount fstypes', () => {
    const parsed = parseLxcFeatures('nesting=1,keyctl=1,mount=nfs;cifs')

    expect(parsed.enabled).toEqual(['nesting', 'keyctl', 'nfs', 'cifs'])
    expect(parsed.otherMounts).toEqual([])
    expect(parsed.extra).toEqual([])
  })

  it('drops a toggle explicitly set to 0 (PVE default) and keeps unknown segments verbatim', () => {
    const parsed = parseLxcFeatures('nesting=0,fuse=1,force_rw_sys=1,mount=ext4;nfs')

    expect(parsed.enabled).toEqual(['fuse', 'nfs'])
    expect(parsed.otherMounts).toEqual(['ext4'])
    expect(parsed.extra).toEqual(['force_rw_sys=1'])
  })

  it('treats a bare key as enabled and is case-insensitive', () => {
    expect(parseLxcFeatures('Nesting, MKNOD=1 ,mount=NFS').enabled).toEqual(['nesting', 'mknod', 'nfs'])
  })

  it('returns nothing enabled for an empty or missing value', () => {
    expect(parseLxcFeatures('').enabled).toEqual([])
    expect(parseLxcFeatures(undefined).enabled).toEqual([])
    expect(parseLxcFeatures(null).enabled).toEqual([])
  })
})

describe('buildLxcFeatures', () => {
  it('serialises in a stable order with a single mount segment', () => {
    expect(buildLxcFeatures({ enabled: ['cifs', 'nesting', 'nfs', 'mknod'], otherMounts: [], extra: [] }))
      .toBe('nesting=1,mknod=1,mount=nfs;cifs')
  })

  it('keeps foreign mount fstypes and unknown segments', () => {
    expect(buildLxcFeatures({ enabled: ['fuse'], otherMounts: ['ext4'], extra: ['force_rw_sys=1'] }))
      .toBe('fuse=1,mount=ext4,force_rw_sys=1')
  })

  it('returns an empty string when nothing is enabled, the caller then deletes the key', () => {
    expect(buildLxcFeatures({ enabled: [], otherMounts: [], extra: [] })).toBe('')
  })

  it('round-trips a parsed string', () => {
    const raw = 'nesting=1,keyctl=1,mount=nfs;cifs'

    expect(buildLxcFeatures(parseLxcFeatures(raw))).toBe(raw)
  })
})

describe('toggleLxcFeature', () => {
  it('adds a toggle that is off', () => {
    expect(toggleLxcFeature('nesting=1', 'keyctl')).toBe('nesting=1,keyctl=1')
  })

  it('removes a toggle that is on without touching the rest', () => {
    expect(toggleLxcFeature('nesting=1,keyctl=1,mount=nfs;cifs', 'nfs')).toBe('nesting=1,keyctl=1,mount=cifs')
  })

  it('removing the last toggle yields an empty string', () => {
    expect(toggleLxcFeature('nesting=1', 'nesting')).toBe('')
  })
})

describe('canEditLxcFeature', () => {
  it('lets only nesting through on an unprivileged container (PVE: everything else is root@pam-only)', () => {
    expect(canEditLxcFeature('nesting', true)).toBe(true)
    expect(canEditLxcFeature('keyctl', true)).toBe(false)
    expect(canEditLxcFeature('fuse', true)).toBe(false)
    expect(canEditLxcFeature('nfs', true)).toBe(false)
  })

  it('locks every feature of a privileged container', () => {
    expect(canEditLxcFeature('nesting', false)).toBe(false)
    expect(canEditLxcFeature('mknod', false)).toBe(false)
  })
})

describe('humanizePveError', () => {
  it('extracts the message of the PVE JSON envelope', () => {
    const raw = 'PVE 403 /nodes/pve1/lxc/101/config: {"data":null,"message":"Permission check failed (changing feature flags (except nesting) is only allowed for root@pam)\\n"}'

    expect(humanizePveError(raw)).toBe('Permission check failed (changing feature flags (except nesting) is only allowed for root@pam)')
  })

  it('keeps the text when the body is not JSON or has no message', () => {
    expect(humanizePveError('PVE 500 /nodes/pve1/lxc/101/config: <html>gateway timeout</html>')).toBe('PVE 500 /nodes/pve1/lxc/101/config: <html>gateway timeout</html>')
    expect(humanizePveError('PVE 400 /x: {"data":null}')).toBe('PVE 400 /x: {"data":null}')
  })

  it('leaves non-PVE errors untouched and accepts Error objects or anything thrown', () => {
    expect(humanizePveError('HTTP 502')).toBe('HTTP 502')
    expect(humanizePveError(new Error('PVE 400 /x: {"data":null,"message":"invalid hostname"}'))).toBe('invalid hostname')
    expect(humanizePveError(42)).toBe('42')
  })
})

describe('optionSaveBody', () => {
  it('sends the edited key as is', () => {
    expect(optionSaveBody('hostname', 'web-01')).toEqual({ hostname: 'web-01' })
    expect(optionSaveBody('features', 'nesting=1')).toEqual({ features: 'nesting=1' })
  })

  it('turns an emptied features string into a delete, which PVE accepts', () => {
    expect(optionSaveBody('features', '')).toEqual({ delete: 'features' })
  })
})

describe('guestNameOptionEdit', () => {
  const t = (key: string) => key

  it('binds a container to hostname with the Hostname label', () => {
    expect(guestNameOptionEdit('lxc', 'ct-01', t)).toEqual({ key: 'hostname', label: 'inventory.createLxc.hostname', value: 'ct-01', type: 'text' })
  })

  it('keeps the QEMU name key for a VM and tolerates a missing name on both guest types', () => {
    expect(guestNameOptionEdit('qemu', 'vm-01', t)).toEqual({ key: 'name', label: 'common.name', value: 'vm-01', type: 'text' })
    expect(guestNameOptionEdit('qemu', undefined, t)).toEqual({ key: 'name', label: 'common.name', value: '', type: 'text' })
    expect(guestNameOptionEdit('lxc', undefined, t).value).toBe('')
  })
})

/* ------------------------------------------------------------------ */
/* fetchDetails: container Options (#566)                              */
/* ------------------------------------------------------------------ */

describe('fetchDetails: container name and features (#566)', () => {
  const jsonRes = (body: any, ok = true) => ({ ok, json: async () => body }) as Response

  function stubFetch(config: Record<string, any>) {
    vi.stubGlobal('fetch', vi.fn((input: any) => {
      const url = String(input)

      if (url.includes('/config')) return Promise.resolve(jsonRes({ data: config }))
      if (url.includes('/status')) return Promise.resolve(jsonRes({ data: {} }))
      if (url.includes('/resources')) return Promise.resolve(jsonRes({ data: [
        { node: 'pve1', vmid: '101', type: 'lxc', name: 'stale-name', status: 'running' },
      ] }))
      if (url.includes('/nodes')) return Promise.resolve(jsonRes({ data: [{ node: 'pve1', status: 'online' }] }))

      return Promise.resolve(jsonRes({ data: {} }))
    }))
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the display name from hostname and exposes the raw features with their pending state', async () => {
    stubFetch({
      hostname: 'ct-101',
      unprivileged: 1,
      features: 'nesting=1,keyctl=1',
      ostype: 'debian',
      pending: { features: 'keyctl=1' },
    })

    const payload = await fetchDetails({ type: 'vm', id: 'conn1:pve1:lxc:101' } as any)

    expect(payload?.vmType).toBe('lxc')
    expect(payload?.name).toBe('ct-101')
    expect(payload?.optionsInfo?.hostname).toBe('ct-101')
    expect(payload?.optionsInfo?.unprivileged).toBe(true)
    expect(payload?.optionsInfo?.features).toBe('nesting=1,keyctl=1')
    expect((payload?.optionsInfo as any)?.pendingKeys).toContain('features')
    expect((payload?.optionsInfo as any)?.pendingValues?.features).toBe('keyctl=1')
  })

  it('leaves the container name to the inventory when the config carries no hostname', async () => {
    stubFetch({ unprivileged: 0 })

    const payload = await fetchDetails({ type: 'vm', id: 'conn1:pve1:lxc:101' } as any)

    expect(payload?.name).toBe('stale-name')
    expect(payload?.optionsInfo?.unprivileged).toBe(false)
    expect(payload?.optionsInfo?.features).toBe('')
    expect(payload?.optionsInfo?.hostname).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ */
/* passthroughLabel — mapped USB/PCI devices on the Hardware tab (#852) */
/* ------------------------------------------------------------------ */

describe('passthroughLabel', () => {
  it('names a mapped device after its resource mapping', () => {
    expect(passthroughLabel('USB', 'mapping=tablet,usb3=1')).toBe('USB (mapping: tablet)')
    expect(passthroughLabel('PCI', 'mapping=gpu,pcie=1,rombar=1')).toBe('PCI (mapping: gpu)')
  })

  it('keeps the raw hardware address of a device added as root@pam', () => {
    expect(passthroughLabel('USB', 'host=046d:c52b,usb3=1')).toBe('USB (046d:c52b)')
    expect(passthroughLabel('PCI', '0000:01:00.0,pcie=1,x-vga=1')).toBe('PCI (0000:01:00.0)')
  })

  it('labels SPICE redirection and bare entries', () => {
    expect(passthroughLabel('USB', 'spice,usb3=1')).toBe('USB (SPICE)')
    expect(passthroughLabel('USB', '')).toBe('USB')
    expect(passthroughLabel('PCI', '')).toBe('PCI')
  })
})

describe('fetchDetails: mapped passthrough devices on the Hardware tab (#852)', () => {
  const jsonRes = (body: any, ok = true) => ({ ok, json: async () => body }) as Response

  function stubFetch(config: Record<string, any>) {
    vi.stubGlobal('fetch', vi.fn((input: any) => {
      const url = String(input)

      if (url.includes('/config')) return Promise.resolve(jsonRes({ data: config }))
      if (url.includes('/status')) return Promise.resolve(jsonRes({ data: {} }))
      if (url.includes('/resources')) return Promise.resolve(jsonRes({ data: [
        { node: 'pve1', vmid: '500', type: 'qemu', name: 'vm500', status: 'stopped' },
      ] }))
      if (url.includes('/nodes')) return Promise.resolve(jsonRes({ data: [{ node: 'pve1', status: 'online' }] }))

      return Promise.resolve(jsonRes({ data: {} }))
    }))
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the mapping name of mapped devices and the address of raw ones', async () => {
    stubFetch({
      name: 'vm500',
      usb0: 'mapping=tablet,usb3=1',
      usb1: 'host=046d:c52b',
      hostpci0: 'mapping=gpu,pcie=1',
    })

    const payload = await fetchDetails({ type: 'vm', id: 'conn1:pve1:qemu:500' } as any)
    const labels = Object.fromEntries((payload?.otherHardwareInfo || []).map(h => [h.id, h.label]))

    expect(labels.usb0).toBe('USB (mapping: tablet)')
    expect(labels.usb1).toBe('USB (046d:c52b)')
    expect(labels.hostpci0).toBe('PCI (mapping: gpu)')
  })
})
