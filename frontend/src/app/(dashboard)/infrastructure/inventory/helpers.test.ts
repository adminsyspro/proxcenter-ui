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
  formatRrdTick,
  formatRrdTooltipTs,
  rrdTimeframeFromSeries,
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
