import { describe, expect, it } from 'vitest'

import { APP_VERSION } from '@/config/version'

import {
  MAX_DETAILS_CHARS,
  SYSLOG_SD_ID,
  actorOf,
  auditFields,
  cefExtensionEscape,
  cefHeaderEscape,
  cefSeverityFor,
  detailsToString,
  escapeSdParam,
  formatCef,
  formatRfc3164,
  formatRfc5424,
  formatSyslogMessage,
  headerToken,
  humanMessage,
  priority,
  rfc3164Timestamp,
  severityFor,
  stripControl,
  type FormatContext,
  isSensitiveKey,
  normalizeIp,
  redactSensitive,
  REDACTED,
} from './format'
import type { SyslogAuditEvent, SyslogDestination } from './types'

const TS = new Date('2026-09-17T09:36:16.000Z')
const ctx: FormatContext = { hostname: 'pxc-01', pid: 4242 }

function dest(overrides: Partial<SyslogDestination> = {}): SyslogDestination {
  return {
    id: 'd1',
    name: 'SIEM',
    enabled: true,
    host: 'siem.example.org',
    port: 514,
    transport: 'udp',
    format: 'rfc5424',
    framing: 'newline',
    facility: 13,
    categories: [],
    tls: { verify: true, ca: '', serverName: '' },
    ...overrides,
  }
}

function evt(overrides: Partial<SyslogAuditEvent> = {}): SyslogAuditEvent {
  return {
    id: 'evt_01',
    timestamp: TS,
    tenantId: 'default',
    userId: 'u1',
    userEmail: 'alice@example.org',
    apiTokenId: null,
    action: 'login',
    category: 'auth',
    resourceType: null,
    resourceId: null,
    resourceName: null,
    details: null,
    ipAddress: '10.0.0.5',
    userAgent: null,
    status: 'success',
    errorMessage: null,
    ...overrides,
  }
}

describe('PRI', () => {
  it('maps the audit status to an RFC 5424 severity', () => {
    expect(severityFor('success')).toBe(6)
    expect(severityFor('warning')).toBe(4)
    expect(severityFor('failure')).toBe(3)
    expect(severityFor('anything-else')).toBe(3)
  })

  it('maps the audit status to the CEF 0-10 scale', () => {
    expect(cefSeverityFor('success')).toBe(3)
    expect(cefSeverityFor('warning')).toBe(6)
    expect(cefSeverityFor('failure')).toBe(8)
  })

  it('computes facility * 8 + severity', () => {
    expect(priority(13, 6)).toBe(110)
    expect(priority(13, 4)).toBe(108)
    expect(priority(13, 3)).toBe(107)
    expect(priority(4, 6)).toBe(38)
  })

  it('opens the line with <110>, <108>, <107> for facility 13', () => {
    expect(formatRfc5424(evt(), dest(), ctx).startsWith('<110>1 ')).toBe(true)
    expect(formatRfc5424(evt({ status: 'warning' }), dest(), ctx).startsWith('<108>1 ')).toBe(true)
    expect(formatRfc5424(evt({ status: 'failure' }), dest(), ctx).startsWith('<107>1 ')).toBe(true)
  })

  it('follows the destination facility in every dialect', () => {
    // local0 = 16 -> 16 * 8 + 6 = 134
    expect(formatRfc5424(evt(), dest({ facility: 16 }), ctx).startsWith('<134>1 ')).toBe(true)
    expect(formatRfc3164(evt(), dest({ facility: 16, format: 'rfc3164' }), ctx).startsWith('<134>Sep')).toBe(true)
    expect(formatCef(evt(), dest({ facility: 16, format: 'cef' }), ctx).startsWith('<134>Sep')).toBe(true)
  })
})

describe('headerToken', () => {
  it('returns NILVALUE for an empty or missing token', () => {
    expect(headerToken(null, 10)).toBe('-')
    expect(headerToken(undefined, 10)).toBe('-')
    expect(headerToken('', 10)).toBe('-')
  })

  it('replaces anything outside PRINTUSASCII with an underscore and truncates', () => {
    expect(headerToken('my host', 255)).toBe('my_host')
    expect(headerToken('héllo', 255)).toBe('h_llo')
    expect(headerToken('abcdef', 3)).toBe('abc')
  })
})

describe('formatRfc5424', () => {
  it('renders header, structured data and human message in one line', () => {
    expect(formatRfc5424(evt(), dest(), ctx)).toBe(
      '<110>1 2026-09-17T09:36:16.000Z pxc-01 proxcenter 4242 login ' +
        `[${SYSLOG_SD_ID} event_id="evt_01" tenant="default" user="alice@example.org" user_id="u1" token_id="-" ` +
        'category="auth" action="login" status="success" ip="10.0.0.5"] ' +
        'alice@example.org login from 10.0.0.5: success',
    )
  })

  it('puts the action in MSGID and the pid in PROCID', () => {
    const tokens = formatRfc5424(evt({ action: 'vm.start' }), dest(), { hostname: 'h', pid: 77 }).split(' ')
    expect(tokens[0]).toBe('<110>1')
    expect(tokens[1]).toBe('2026-09-17T09:36:16.000Z')
    expect(tokens[2]).toBe('h')
    expect(tokens[3]).toBe('proxcenter')
    expect(tokens[4]).toBe('77')
    expect(tokens[5]).toBe('vm.start')
    expect(tokens[6]).toBe(`[${SYSLOG_SD_ID}`)
  })

  it('turns a space in the hostname into an underscore', () => {
    const line = formatRfc5424(evt(), dest(), { hostname: 'my host', pid: 1 })
    expect(line.split(' ')[2]).toBe('my_host')
  })

  it('honours a custom appName', () => {
    const line = formatRfc5424(evt(), dest(), { ...ctx, appName: 'pxc-audit' })
    expect(line.split(' ')[3]).toBe('pxc-audit')
  })

  it('escapes ", \\ and ] inside SD param values', () => {
    const line = formatRfc5424(
      evt({ resourceType: 'vm', resourceId: '100', resourceName: 'say "hi" \\ ]' }),
      dest(),
      ctx,
    )
    expect(line).toContain('resource_name="say \\"hi\\" \\\\ \\]"')
    // the SD element still closes exactly once, right before the free text
    expect(line).toContain('\\]" ip="10.0.0.5"] alice@example.org')
  })

  it('flattens control characters so the line stays one line', () => {
    const line = formatRfc5424(
      evt({ details: 'line1\nline2', errorMessage: 'bad\r\nthing', status: 'failure' }),
      dest(),
      ctx,
    )
    expect(line).not.toMatch(/[\r\n]/)
    expect(line).toContain('details="line1 line2"')
    expect(line).toContain('error="bad  thing"')
    expect(line.endsWith(': failure (bad  thing)')).toBe(true)
  })
})

describe('escaping helpers', () => {
  it('escapeSdParam escapes backslash, double quote and closing bracket', () => {
    expect(escapeSdParam('a"b\\c]d')).toBe('a\\"b\\\\c\\]d')
    expect(escapeSdParam('plain [text')).toBe('plain [text')
  })

  it('stripControl replaces every control character with a space', () => {
    expect(stripControl('a\nb')).toBe('a b')
    expect(stripControl('a\r\nb\tc\x00d\x7fe')).toBe('a  b c d e')
    expect(stripControl('plain')).toBe('plain')
  })
})

describe('detailsToString', () => {
  it('returns null for empty payloads', () => {
    expect(detailsToString({})).toBeNull()
    expect(detailsToString(null)).toBeNull()
    expect(detailsToString(undefined)).toBeNull()
    expect(detailsToString('')).toBeNull()
    expect(detailsToString('{}')).toBeNull()
  })

  it('serialises objects and keeps strings as they are', () => {
    expect(detailsToString({ vmid: 100, node: 'pve1' })).toBe('{"vmid":100,"node":"pve1"}')
    expect(detailsToString('free text')).toBe('free text')
    expect(detailsToString([1, 2])).toBe('[1,2]')
  })

  it('truncates long payloads to MAX_DETAILS_CHARS with an ellipsis', () => {
    const out = detailsToString('x'.repeat(MAX_DETAILS_CHARS + 500))
    expect(out).toHaveLength(MAX_DETAILS_CHARS)
    expect(out?.endsWith('…')).toBe(true)
    expect(out?.startsWith('xxx')).toBe(true)

    const obj = detailsToString({ blob: 'y'.repeat(6000) })
    expect(obj).toHaveLength(MAX_DETAILS_CHARS)
    expect(obj?.endsWith('…')).toBe(true)
  })

  it('does not truncate a payload of exactly MAX_DETAILS_CHARS', () => {
    const out = detailsToString('z'.repeat(MAX_DETAILS_CHARS))
    expect(out).toBe('z'.repeat(MAX_DETAILS_CHARS))
  })

  it('falls back to String() when JSON.stringify throws', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(detailsToString(circular)).toBe('[object Object]')
  })
})

describe('humanMessage', () => {
  it('names the actor by email first', () => {
    expect(humanMessage(evt())).toBe('alice@example.org login from 10.0.0.5: success')
  })

  it('falls back to userId, then token:<id>, then anonymous', () => {
    expect(humanMessage(evt({ userEmail: null }))).toBe('u1 login from 10.0.0.5: success')
    expect(humanMessage(evt({ userEmail: null, userId: null, apiTokenId: 'tok1' }))).toBe(
      'token:tok1 login from 10.0.0.5: success',
    )
    expect(humanMessage(evt({ userEmail: null, userId: null, apiTokenId: null }))).toBe(
      'anonymous login from 10.0.0.5: success',
    )
    expect(actorOf(evt({ userEmail: null, userId: null }))).toBe('anonymous')
  })

  it('omits the origin when the ip is unknown or missing', () => {
    expect(humanMessage(evt({ ipAddress: 'unknown' }))).toBe('alice@example.org login: success')
    expect(humanMessage(evt({ ipAddress: null }))).toBe('alice@example.org login: success')
  })

  it('lists resource type, id and name before the origin', () => {
    expect(
      humanMessage(evt({ action: 'start', resourceType: 'vm', resourceId: '100', resourceName: 'web-01' })),
    ).toBe('alice@example.org start vm 100 (web-01) from 10.0.0.5: success')
  })

  it('appends the error message in parentheses', () => {
    expect(humanMessage(evt({ status: 'failure', errorMessage: 'disk full' }))).toBe(
      'alice@example.org login from 10.0.0.5: failure (disk full)',
    )
  })

  it('truncates a very long error message', () => {
    const msg = humanMessage(evt({ status: 'failure', errorMessage: 'e'.repeat(2000) }))
    expect(msg).toContain('(' + 'e'.repeat(1023) + '…)')
    expect(msg).not.toContain('e'.repeat(1024))
  })
})

describe('auditFields', () => {
  it('always emits the eight base fields in order, with NILVALUE for missing identity', () => {
    const fields = auditFields(evt({ userEmail: null, userId: null, apiTokenId: null, ipAddress: null }))
    expect(fields).toEqual([
      ['event_id', 'evt_01'],
      ['tenant', 'default'],
      ['user', '-'],
      ['user_id', '-'],
      ['token_id', '-'],
      ['category', 'auth'],
      ['action', 'login'],
      ['status', 'success'],
    ])
  })

  it('adds the optional fields when present, truncating user agent and error', () => {
    const fields = auditFields(
      evt({
        resourceType: 'vm',
        resourceId: '100',
        resourceName: 'web-01',
        userAgent: 'u'.repeat(300),
        errorMessage: 'boom',
        details: { vmid: 100 },
      }),
    )
    const keys = fields.map(([k]) => k)
    expect(keys).toEqual([
      'event_id',
      'tenant',
      'user',
      'user_id',
      'token_id',
      'category',
      'action',
      'status',
      'resource_type',
      'resource_id',
      'resource_name',
      'ip',
      'user_agent',
      'error',
      'details',
    ])
    const ua = fields.find(([k]) => k === 'user_agent')?.[1] ?? ''
    expect(ua).toHaveLength(256)
    expect(ua.endsWith('…')).toBe(true)
    expect(fields.find(([k]) => k === 'details')?.[1]).toBe('{"vmid":100}')
  })
})

describe('formatRfc3164', () => {
  it('renders the BSD timestamp in UTC with a space-padded day', () => {
    expect(rfc3164Timestamp(new Date('2026-09-07T09:36:16.000Z'))).toBe('Sep  7 09:36:16')
    expect(rfc3164Timestamp(TS)).toBe('Sep 17 09:36:16')
    expect(rfc3164Timestamp(new Date('2026-01-01T00:00:00.000Z'))).toBe('Jan  1 00:00:00')
    expect(rfc3164Timestamp(new Date('2026-12-31T23:59:59.000Z'))).toBe('Dec 31 23:59:59')
  })

  it('renders header, proxcenter[pid] tag, human message and key="value" tail', () => {
    expect(formatRfc3164(evt(), dest({ format: 'rfc3164' }), ctx)).toBe(
      '<110>Sep 17 09:36:16 pxc-01 proxcenter[4242]: alice@example.org login from 10.0.0.5: success ' +
        'event_id="evt_01" tenant="default" user="alice@example.org" user_id="u1" token_id="-" ' +
        'category="auth" action="login" status="success" ip="10.0.0.5"',
    )
  })

  it('replaces double quotes in values with single quotes', () => {
    const line = formatRfc3164(
      evt({ resourceType: 'vm', resourceId: '100', resourceName: 'say "hi"' }),
      dest({ format: 'rfc3164' }),
      ctx,
    )
    expect(line).toContain(`resource_name="say 'hi'"`)
    // the free-text part keeps the original quotes; only the key="value" tail must be quote-safe
    const tail = line.slice(line.indexOf(' event_id="'))
    expect(tail).not.toContain('say "hi"')
    expect(tail.match(/"/g)?.length).toBe(2 * tail.split('=').length - 2)
  })

  it('sanitises the hostname like RFC 5424 does', () => {
    const line = formatRfc3164(evt(), dest({ format: 'rfc3164' }), { hostname: 'my host', pid: 9 })
    expect(line.startsWith('<110>Sep 17 09:36:16 my_host proxcenter[9]: ')).toBe(true)
  })
})

describe('formatCef', () => {
  const rich = evt({ action: 'start', category: 'vms', resourceType: 'vm', resourceId: '100', resourceName: 'web-01' })

  it('renders the CEF header after a BSD header and the extension in a fixed order', () => {
    const line = formatCef(rich, dest({ format: 'cef' }), { ...ctx, version: '1.4.10' })
    expect(line).toBe(
      '<110>Sep 17 09:36:16 pxc-01 CEF:0|ProxCenter|ProxCenter|1.4.10|vms.start|vms start|3|' +
        `rt=${TS.getTime()} externalId=evt_01 act=start cat=vms outcome=success suser=alice@example.org dvchost=pxc-01 ` +
        'suid=u1 src=10.0.0.5 cs1Label=tenant cs1=default cs2Label=resourceType cs2=vm cs3Label=resourceId cs3=100 ' +
        'cs4Label=resourceName cs4=web-01 msg=alice@example.org start vm 100 (web-01) from 10.0.0.5: success',
    )
  })

  it('maps the status to 3, 6 or 8 in the severity header field', () => {
    const sev = (status: string) => formatCef(evt({ status }), dest({ format: 'cef' }), ctx).split('|')[6]
    expect(sev('success')).toBe('3')
    expect(sev('warning')).toBe('6')
    expect(sev('failure')).toBe('8')
  })

  it('defaults the header version to APP_VERSION', () => {
    const line = formatCef(evt(), dest({ format: 'cef' }), ctx)
    expect(line.split('|')[3]).toBe(cefHeaderEscape(APP_VERSION))
  })

  it('escapes pipe and backslash in header fields', () => {
    expect(cefHeaderEscape('a|b\\c')).toBe('a\\|b\\\\c')
    const line = formatCef(evt({ category: 'vms', action: 'a|b\\c' }), dest({ format: 'cef' }), ctx)
    expect(line).toContain('|vms.a\\|b\\\\c|vms a\\|b\\\\c|3|')
  })

  it('escapes = and backslash in extension values', () => {
    expect(cefExtensionEscape('k=v')).toBe('k\\=v')
    expect(cefExtensionEscape('a\\b')).toBe('a\\\\b')
    const line = formatCef(evt({ resourceType: 'vm', resourceId: '100', resourceName: 'k=v' }), dest({ format: 'cef' }), ctx)
    expect(line).toContain(' cs4=k\\=v ')
    expect(line.endsWith(' msg=alice@example.org login vm 100 (k\\=v) from 10.0.0.5: success')).toBe(true)
  })

  it('encodes a newline in an extension value as \\n and other controls as a space', () => {
    expect(cefExtensionEscape('a\nb')).toBe('a\\nb')
    expect(cefExtensionEscape('a\r\nb')).toBe('a\\nb')
    expect(cefExtensionEscape('a\tb')).toBe('a b')
    const line = formatCef(
      evt({ status: 'failure', errorMessage: 'disk full\nretry later' }),
      dest({ format: 'cef' }),
      ctx,
    )
    expect(line).toContain(' reason=disk full\\nretry later ')
    expect(line).not.toMatch(/\n/)
  })

  it('carries the tenant in cs1 and keeps msg as the last extension', () => {
    const line = formatCef(rich, dest({ format: 'cef' }), ctx)
    expect(line).toContain(' cs1Label=tenant cs1=default ')
    expect(line.endsWith(` msg=${cefExtensionEscape(humanMessage(rich))}`)).toBe(true)
  })

  it('falls back to token:<id> for suser and records the token in cs5', () => {
    const line = formatCef(evt({ userEmail: null, userId: null, apiTokenId: 'tok1' }), dest({ format: 'cef' }), ctx)
    expect(line).toContain(' suser=token:tok1 ')
    expect(line).toContain(' cs5Label=apiTokenId cs5=tok1 ')
    expect(line).not.toContain(' suid=')
  })

  it('drops src when the ip is unknown and puts details into cs6', () => {
    const line = formatCef(evt({ ipAddress: 'unknown', details: { vmid: 100 } }), dest({ format: 'cef' }), ctx)
    expect(line).not.toContain(' src=')
    expect(line).toContain(' cs6Label=details cs6={"vmid":100} ')
  })
})

describe('formatSyslogMessage', () => {
  it('dispatches on dest.format', () => {
    const e = evt()
    expect(formatSyslogMessage(e, dest({ format: 'rfc5424' }), ctx)).toBe(formatRfc5424(e, dest({ format: 'rfc5424' }), ctx))
    expect(formatSyslogMessage(e, dest({ format: 'rfc3164' }), ctx)).toBe(formatRfc3164(e, dest({ format: 'rfc3164' }), ctx))
    expect(formatSyslogMessage(e, dest({ format: 'cef' }), ctx)).toBe(formatCef(e, dest({ format: 'cef' }), ctx))
  })

  it('produces three distinct dialects for the same event', () => {
    const e = evt()
    const a = formatSyslogMessage(e, dest({ format: 'rfc5424' }), ctx)
    const b = formatSyslogMessage(e, dest({ format: 'rfc3164' }), ctx)
    const c = formatSyslogMessage(e, dest({ format: 'cef' }), ctx)
    expect(a.startsWith('<110>1 ')).toBe(true)
    expect(b.startsWith('<110>Sep 17')).toBe(true)
    expect(c).toContain(' CEF:0|')
    expect(new Set([a, b, c]).size).toBe(3)
  })
})

describe('redaction before leaving the box', () => {
  it('masks passwords, secrets, tokens and keys but keeps identifiers and names', () => {
    const out = redactSensitive({
      sshPassEnc: 'gAAAA-encrypted',
      password: 'hunter2',
      apiKey: 'sk-live',
      privateKey: '-----BEGIN',
      authorization: 'Bearer x',
      tokenId: 'tok_123',
      tokenName: 'ci',
      keyName: 'ssh-lab',
      sshAuthMethod: 'key',
      name: 'PVE-DR',
      nested: [{ secret: 's', prefix: 'pxc_ab' }],
      emptySecret: '',
      nullPass: null,
    }) as Record<string, unknown>
    expect(out.sshPassEnc).toBe(REDACTED)
    expect(out.password).toBe(REDACTED)
    expect(out.apiKey).toBe(REDACTED)
    expect(out.privateKey).toBe(REDACTED)
    expect(out.authorization).toBe(REDACTED)
    expect(out.tokenId).toBe('tok_123')
    expect(out.tokenName).toBe('ci')
    expect(out.keyName).toBe('ssh-lab')
    expect(out.sshAuthMethod).toBe('key')
    expect(out.name).toBe('PVE-DR')
    expect((out.nested as any[])[0]).toEqual({ secret: REDACTED, prefix: 'pxc_ab' })
    expect(out.emptySecret).toBe('')
    expect(out.nullPass).toBeNull()
  })

  it('isSensitiveKey draws the line the tests above rely on', () => {
    for (const k of ['sshPassEnc', 'passphrase', 'client_secret', 'api-key', 'refreshToken', 'cookie', 'otp']) {
      expect(isSensitiveKey(k), k).toBe(true)
    }
    for (const k of ['apiTokenId', 'token_id', 'secretName', 'passwordEnabled', 'tokenCount', 'host', 'port']) {
      expect(isSensitiveKey(k), k).toBe(false)
    }
  })

  it('redacts inside the rendered details of every dialect', () => {
    const e = evt({ details: { sshPassEnc: 'blob', host: 'h' } })
    for (const format of ['rfc5424', 'rfc3164', 'cef'] as const) {
      const line = formatSyslogMessage(e, dest({ format }), ctx)
      expect(line, format).not.toContain('blob')
      expect(line, format).toContain('redacted')
    }
  })

  it('does not touch the original details object', () => {
    const details = { password: 'p', inner: { secret: 's' } }
    redactSensitive(details)
    expect(details.password).toBe('p')
    expect(details.inner.secret).toBe('s')
  })
})

describe('normalizeIp', () => {
  it('unwraps IPv4-mapped IPv6 peers and leaves everything else alone', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1')
    expect(normalizeIp('::FFFF:10.42.0.5')).toBe('10.42.0.5')
    expect(normalizeIp('::1')).toBe('::1')
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1')
    expect(normalizeIp('10.0.0.1')).toBe('10.0.0.1')
    expect(normalizeIp(null)).toBeNull()
    expect(normalizeIp('')).toBeNull()
  })

  it('applies to the human message, the structured data and the CEF src', () => {
    const e = evt({ ipAddress: '::ffff:10.0.0.12' })
    expect(formatRfc5424(e, dest(), ctx)).toContain('ip="10.0.0.12"')
    expect(formatRfc5424(e, dest(), ctx)).toContain('from 10.0.0.12')
    expect(formatRfc5424(e, dest(), ctx)).not.toContain('::ffff')
    expect(formatCef(e, dest({ format: 'cef' }), ctx)).toContain(' src=10.0.0.12 ')
  })
})
