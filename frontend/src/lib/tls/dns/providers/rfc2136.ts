// src/lib/tls/dns/providers/rfc2136.ts
//
// Dynamic DNS update (RFC 2136) signed with TSIG (RFC 8945), what nsupdate
// does, sent straight to the zone's primary: BIND, Knot, PowerDNS, anything
// that takes a shared key. Node ships no DNS library and the subset needed
// here is small (a SOA query, an update of one TXT value, a TSIG on each), so
// the messages are built and read by hand. UDP first, TCP when the answer is
// truncated or UDP gets nothing back.

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { lookup } from 'node:dns/promises'
import { connect, isIP } from 'node:net'

import { DnsProviderError, type DnsProviderFactory } from '@/lib/tls/dns/types'
import { relativeName, requireField, zoneCandidates } from '@/lib/tls/dns/util'

const LABEL = 'RFC 2136'
const DEFAULT_PORT = 53
const UDP_TIMEOUT_MS = 5_000
const TCP_TIMEOUT_MS = 10_000

// Without EDNS a UDP message is capped at 512 bytes (RFC 1035); anything
// bigger goes straight to TCP.
const UDP_MAX_BYTES = 512
const TXT_TTL = 60
const TSIG_FUDGE_S = 300

const OPCODE_UPDATE = 5
const TYPE_SOA = 6
const TYPE_TXT = 16
const TYPE_TSIG = 250
const CLASS_IN = 1
const CLASS_NONE = 254
const CLASS_ANY = 255
const FLAG_QR = 0x8000
const FLAG_AA = 0x0400
const FLAG_TC = 0x0200

// Field value to node:crypto digest; on the wire the algorithm is the field
// value as a domain name (`hmac-sha256.`), RFC 8945 §6.
const TSIG_ALGORITHMS: Record<string, string> = {
  'hmac-sha1': 'sha1',
  'hmac-sha224': 'sha224',
  'hmac-sha256': 'sha256',
  'hmac-sha384': 'sha384',
  'hmac-sha512': 'sha512',
}

const RCODE_NAMES = ['NOERROR', 'FORMERR', 'SERVFAIL', 'NXDOMAIN', 'NOTIMP', 'REFUSED', 'YXDOMAIN', 'YXRRSET', 'NXRRSET', 'NOTAUTH', 'NOTZONE']
const TSIG_ERROR_NAMES: Record<number, string> = { 16: 'BADSIG', 17: 'BADKEY', 18: 'BADTIME', 22: 'BADTRUNC' }
const EMPTY = Buffer.alloc(0)

// ---------------------------------------------------------------------------
// Wire format, writing.

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2)

  buffer.writeUInt16BE(value)

  return buffer
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4)

  buffer.writeUInt32BE(value)

  return buffer
}

/** Time signed is 48 bits of seconds since the epoch. */
function u48(value: number): Buffer {
  return Buffer.concat([u16(Math.floor(value / 2 ** 32)), u32(value % 2 ** 32)])
}

/** A domain name in canonical wire form: lowercase labels, no compression (RFC 4034 §6.2, what TSIG digests). */
export function encodeName(name: string): Buffer {
  const trimmed = name.replace(/\.$/, '').toLowerCase()

  if (!trimmed) return Buffer.from([0])

  const parts: Buffer[] = []

  for (const label of trimmed.split('.')) {
    const bytes = Buffer.from(label, 'utf8')

    if (bytes.length === 0 || bytes.length > 63) throw new DnsProviderError(`${LABEL}: "${name}" is not a valid DNS name`)
    parts.push(Buffer.from([bytes.length]), bytes)
  }

  parts.push(Buffer.from([0]))

  const encoded = Buffer.concat(parts)

  if (encoded.length > 255) throw new DnsProviderError(`${LABEL}: "${name}" is longer than a DNS name may be`)

  return encoded
}

function header(id: number, flags: number, counts: [number, number, number, number]): Buffer {
  return Buffer.concat([u16(id), u16(flags), ...counts.map(u16)])
}

function resourceRecord(name: string, type: number, cls: number, ttl: number, rdata: Buffer): Buffer {
  return Buffer.concat([encodeName(name), u16(type), u16(cls), u32(ttl), u16(rdata.length), rdata])
}

/** TXT RDATA: the value as character-strings of at most 255 bytes each. */
export function txtRdata(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8')

  if (bytes.length === 0) return Buffer.from([0])

  const chunks: Buffer[] = []

  for (let offset = 0; offset < bytes.length; offset += 255) {
    const chunk = bytes.subarray(offset, offset + 255)

    chunks.push(Buffer.from([chunk.length]), chunk)
  }

  return Buffer.concat(chunks)
}

export function buildSoaQuery(id: number, zone: string): Buffer {
  // RD clear: the answer must come from the server's own authority, not its cache.
  return Buffer.concat([header(id, 0, [1, 0, 0, 0]), encodeName(zone), u16(TYPE_SOA), u16(CLASS_IN)])
}

export type UpdateAction = 'add' | 'delete'

/**
 * One UPDATE (opcode 5) with the zone section and a single update RR. Adding
 * is the RR itself (RFC 2136 §2.5.1), which leaves every other value at the
 * name alone; deleting one value is the same RR in class NONE with TTL 0
 * (§2.5.4), never the "delete all RRs of a type" form.
 */
export function buildTxtUpdate(id: number, zone: string, fqdn: string, value: string, action: UpdateAction): Buffer {
  const [cls, ttl] = action === 'add' ? [CLASS_IN, TXT_TTL] : [CLASS_NONE, 0]

  return Buffer.concat([
    header(id, OPCODE_UPDATE << 11, [1, 0, 1, 0]),
    encodeName(zone), u16(TYPE_SOA), u16(CLASS_IN),
    resourceRecord(fqdn, TYPE_TXT, cls, ttl, txtRdata(value)),
  ])
}

// ---------------------------------------------------------------------------
// TSIG (RFC 8945).

export interface TsigKey {
  name: string
  /** One of the catalog values, `hmac-sha256` and friends. */
  algorithm: string
  secret: Buffer
}

/** The TSIG variables that are digested along with the message (RFC 8945 §4.3.3). */
function tsigVariables(key: TsigKey, timeSigned: number, fudge: number, error: number, other: Buffer): Buffer {
  return Buffer.concat([
    encodeName(key.name), u16(CLASS_ANY), u32(0),
    encodeName(key.algorithm), u48(timeSigned), u16(fudge), u16(error), u16(other.length), other,
  ])
}

/**
 * The MAC over a message as it was before its TSIG RR was appended (ARCOUNT
 * not counting it). A response also digests the MAC of the request it
 * answers, length-prefixed (§4.3.1).
 */
export function tsigMac(key: TsigKey, message: Buffer, timeSigned: number, fudge: number, error: number, other: Buffer, requestMac?: Buffer): Buffer {
  const hmac = createHmac(TSIG_ALGORITHMS[key.algorithm], key.secret)

  if (requestMac) hmac.update(Buffer.concat([u16(requestMac.length), requestMac]))
  hmac.update(message)
  hmac.update(tsigVariables(key, timeSigned, fudge, error, other))

  return hmac.digest()
}

/** Appends the TSIG RR to `message` and bumps ARCOUNT; returns the MAC too, the response is verified against it. */
export function tsigSign(message: Buffer, key: TsigKey, timeSigned: number): { message: Buffer; mac: Buffer } {
  const mac = tsigMac(key, message, timeSigned, TSIG_FUDGE_S, 0, EMPTY)
  const rdata = Buffer.concat([
    encodeName(key.algorithm), u48(timeSigned), u16(TSIG_FUDGE_S), u16(mac.length), mac, message.subarray(0, 2), u16(0), u16(0),
  ])
  const signed = Buffer.concat([message, resourceRecord(key.name, TYPE_TSIG, CLASS_ANY, 0, rdata)])

  signed.writeUInt16BE(signed.readUInt16BE(10) + 1, 10)

  return { message: signed, mac }
}

// ---------------------------------------------------------------------------
// Wire format, reading.

export interface DnsQuestion {
  name: string
  type: number
  cls: number
}

export interface DnsRecord extends DnsQuestion {
  ttl: number
  rdata: Buffer
  /** Where the RR starts in the message: the TSIG RR is cut off there to verify it. */
  offset: number
  rdataOffset: number
}

export interface DnsMessage {
  id: number
  flags: number
  rcode: number
  questions: DnsQuestion[]
  answers: DnsRecord[]
  authority: DnsRecord[]
  additional: DnsRecord[]
}

function malformed(detail: string): DnsProviderError {
  return new DnsProviderError(`${LABEL}: malformed answer (${detail})`)
}

/** A name at `offset`, compression pointers followed; `next` is where the field after the name starts. */
export function readName(buffer: Buffer, offset: number): { name: string; next: number } {
  const labels: string[] = []
  let position = offset
  let next = -1
  let hops = 0

  for (;;) {
    if (position >= buffer.length) throw malformed('name runs past the end')

    const length = buffer[position]

    if (length === 0) {
      position += 1
      break
    }

    if ((length & 0xc0) === 0xc0) {
      if (position + 1 >= buffer.length) throw malformed('pointer runs past the end')
      if (++hops > 64) throw malformed('name pointer loop')

      // Parsing resumes after the first pointer; the rest is read from where it points.
      if (next < 0) next = position + 2
      position = ((length & 0x3f) << 8) | buffer[position + 1]
      continue
    }

    if ((length & 0xc0) !== 0) throw malformed(`label type ${length >> 6}`)

    labels.push(buffer.subarray(position + 1, position + 1 + length).toString('utf8').toLowerCase())
    position += 1 + length
  }

  return { name: labels.join('.'), next: next < 0 ? position : next }
}

export function parseMessage(buffer: Buffer): DnsMessage {
  if (buffer.length < 12) throw malformed('shorter than a header')

  const counts = [4, 6, 8, 10].map(at => buffer.readUInt16BE(at))
  let offset = 12

  const need = (end: number) => {
    if (end > buffer.length) throw malformed('section runs past the end')
  }

  const questions: DnsQuestion[] = []

  for (let i = 0; i < counts[0]; i++) {
    const { name, next } = readName(buffer, offset)

    need(next + 4)
    questions.push({ name, type: buffer.readUInt16BE(next), cls: buffer.readUInt16BE(next + 2) })
    offset = next + 4
  }

  const section = (count: number): DnsRecord[] => {
    const records: DnsRecord[] = []

    for (let i = 0; i < count; i++) {
      const start = offset
      const { name, next } = readName(buffer, offset)

      need(next + 10)

      const rdataOffset = next + 10
      const rdataLength = buffer.readUInt16BE(next + 8)

      need(rdataOffset + rdataLength)
      records.push({
        name,
        type: buffer.readUInt16BE(next),
        cls: buffer.readUInt16BE(next + 2),
        ttl: buffer.readUInt32BE(next + 4),
        rdata: buffer.subarray(rdataOffset, rdataOffset + rdataLength),
        offset: start,
        rdataOffset,
      })
      offset = rdataOffset + rdataLength
    }

    return records
  }

  const flags = buffer.readUInt16BE(2)

  return {
    id: buffer.readUInt16BE(0),
    flags,
    rcode: flags & 0xf,
    questions,
    answers: section(counts[1]),
    authority: section(counts[2]),
    additional: section(counts[3]),
  }
}

interface TsigFields {
  keyName: string
  algorithm: string
  timeSigned: number
  fudge: number
  mac: Buffer
  originalId: number
  error: number
  other: Buffer
  record: DnsRecord
}

/** The TSIG RR, always the last one of the additional section when present. */
function readTsig(buffer: Buffer, message: DnsMessage): TsigFields | undefined {
  const record = message.additional[message.additional.length - 1]

  if (!record || record.type !== TYPE_TSIG) return undefined

  const end = record.rdataOffset + record.rdata.length
  const algorithm = readName(buffer, record.rdataOffset)
  let at = algorithm.next

  const take = (length: number): number => {
    if (at + length > end) throw malformed('TSIG record too short')
    at += length

    return at - length
  }

  const timeSigned = buffer.readUInt16BE(take(2)) * 2 ** 32 + buffer.readUInt32BE(take(4))
  const fudge = buffer.readUInt16BE(take(2))
  const macLength = buffer.readUInt16BE(take(2))
  const mac = buffer.subarray(take(macLength), at)
  const originalId = buffer.readUInt16BE(take(2))
  const error = buffer.readUInt16BE(take(2))
  const otherLength = buffer.readUInt16BE(take(2))
  const other = buffer.subarray(take(otherLength), at)

  return { keyName: record.name, algorithm: algorithm.name, timeSigned, fudge, mac, originalId, error, other, record }
}

// ---------------------------------------------------------------------------
// Operator-readable failures. None of them ever carries the secret.

function rcodeName(rcode: number): string {
  return RCODE_NAMES[rcode] ?? `RCODE ${rcode}`
}

function describeTsigError(error: number, keyName: string): string {
  switch (error) {
    case 17:
      return `the server does not know the key "${keyName}" (BADKEY)`
    case 16:
      return `the server rejected the signature made with key "${keyName}" (BADSIG): the secret or the algorithm does not match`
    case 18:
      return `the server rejected the signature time (BADTIME): its clock and this host's differ by more than ${TSIG_FUDGE_S} s`
    default:
      return `the server rejected the TSIG signature (${TSIG_ERROR_NAMES[error] ?? `error ${error}`})`
  }
}

type Operation = 'update' | 'query'

function describeRcode(rcode: number, operation: Operation, zone: string, keyName: string, where: string): string {
  const what = operation === 'update' ? `the update of ${zone}` : `the signed SOA query for ${zone}`

  switch (rcode) {
    case 5:
      return operation === 'update'
        ? `${where} refused ${what} (REFUSED): key "${keyName}" is not allowed to change TXT records there (allow-update / update-policy)`
        : `${where} refused ${what} (REFUSED): check allow-query for this key or this address`
    case 9:
      return `${where} is not authoritative for ${zone} (NOTAUTH): updates must go to the zone's primary`
    case 10:
      return `the name is outside the zone ${zone} (NOTZONE): set the zone field to the zone that holds it`
    case 2:
      return `${where} failed on ${what} (SERVFAIL): see its log (zone not writable, journal, or a frozen zone)`
    case 4:
      return `${where} does not implement dynamic updates (NOTIMP)`
    case 1:
      return `${where} could not parse ${what} (FORMERR)`
    default:
      return `${where} answered ${rcodeName(rcode)} to ${what}`
  }
}

// ---------------------------------------------------------------------------
// Transport.

export function parseServer(raw: string): { host: string; port: number } {
  const value = raw.trim()
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(value)
  let host = value
  let portText: string | undefined

  if (bracketed) {
    [, host, portText] = bracketed
  } else if (isIP(value) !== 6 && value.includes(':')) {
    host = value.slice(0, value.lastIndexOf(':'))
    portText = value.slice(value.lastIndexOf(':') + 1)
  }

  const port = portText === undefined ? DEFAULT_PORT : Number(portText)

  if (!host || !/^\d+$/.test(portText ?? '53') || port < 1 || port > 65535) {
    throw new DnsProviderError(`${LABEL}: "${raw}" is not a valid server (host, host:port or [ipv6]:port)`)
  }

  return { host, port }
}

function udpExchange(address: string, family: number, port: number, message: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = createSocket(family === 6 ? 'udp6' : 'udp4')
    let done = false

    const finish = (err: Error | null, data?: Buffer) => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket.close()
      if (err) reject(err)
      else resolve(data!)
    }

    const timer = setTimeout(() => finish(new Error(`no answer within ${UDP_TIMEOUT_MS / 1000} s`)), UDP_TIMEOUT_MS)

    socket.on('error', finish)

    // Anything that is not the answer to this very message is somebody else's.
    socket.on('message', data => {
      if (data.length >= 2 && data.readUInt16BE(0) === message.readUInt16BE(0)) finish(null, data)
    })
    socket.send(message, port, address, err => {
      if (err) finish(err)
    })
  })
}

function tcpExchange(address: string, port: number, message: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: address, port })
    let pending = EMPTY
    let done = false

    const finish = (err: Error | null, data?: Buffer) => {
      if (done) return
      done = true
      socket.destroy()
      if (err) reject(err)
      else resolve(data!)
    }

    socket.setTimeout(TCP_TIMEOUT_MS, () => finish(new Error(`no answer within ${TCP_TIMEOUT_MS / 1000} s`)))
    socket.on('error', finish)
    socket.on('close', () => finish(new Error('connection closed before the answer')))
    socket.on('connect', () => socket.write(Buffer.concat([u16(message.length), message])))

    // Two bytes of length, then the message, possibly across several chunks.
    socket.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk])

      if (pending.length >= 2 && pending.length >= 2 + pending.readUInt16BE(0)) {
        finish(null, pending.subarray(2, 2 + pending.readUInt16BE(0)))
      }
    })
  })
}

// ---------------------------------------------------------------------------

export const createRfc2136Provider: DnsProviderFactory = credentials => {
  const server = parseServer(requireField(credentials, 'server', LABEL))
  const keyName = requireField(credentials, 'keyName', LABEL).replace(/\.$/, '').toLowerCase()
  const algorithm = requireField(credentials, 'keyAlgorithm', LABEL).toLowerCase()
  const secretText = requireField(credentials, 'keySecret', LABEL).replace(/\s+/g, '')
  const pinnedZone = credentials.zone?.trim().replace(/\.$/, '').toLowerCase() || ''
  const where = `${server.host}:${server.port}`

  if (!TSIG_ALGORITHMS[algorithm]) throw new DnsProviderError(`${LABEL}: unsupported key algorithm "${algorithm}"`)
  if (!/^[A-Za-z0-9+/]+=*$/.test(secretText)) throw new DnsProviderError(`${LABEL}: the key secret is not base64 (what "tsig-keygen" prints after "secret")`)

  const key: TsigKey = { name: keyName, algorithm, secret: Buffer.from(secretText, 'base64') }
  const zones = new Map<string, string>()
  let resolved: Promise<{ address: string; family: number }> | undefined

  function resolveServer(): Promise<{ address: string; family: number }> {
    resolved ??= (async () => {
      const family = isIP(server.host)

      if (family) return { address: server.host, family }

      try {
        return await lookup(server.host)
      } catch (err: any) {
        resolved = undefined
        throw new DnsProviderError(`${LABEL}: cannot resolve ${server.host} (${err?.code || err?.message || err})`)
      }
    })()

    return resolved
  }

  async function exchange(message: Buffer): Promise<Buffer> {
    const { address, family } = await resolveServer()
    let udpFailure = 'skipped, message too big'

    if (message.length <= UDP_MAX_BYTES) {
      try {
        const answer = await udpExchange(address, family, server.port, message)

        if (!(answer.readUInt16BE(2) & FLAG_TC)) return answer
        udpFailure = 'truncated answer'
      } catch (err: any) {
        udpFailure = err?.message || String(err)
      }
    }

    try {
      return await tcpExchange(address, server.port, message)
    } catch (err: any) {
      throw new DnsProviderError(`${LABEL}: ${where} unreachable (udp: ${udpFailure}; tcp: ${err?.message || err})`)
    }
  }

  function parseAnswer(raw: Buffer, request: Buffer): DnsMessage {
    const answer = parseMessage(raw)

    if (answer.id !== request.readUInt16BE(0) || !(answer.flags & FLAG_QR)) throw malformed('not the reply to this request')

    return answer
  }

  /**
   * Sends `unsigned` with a TSIG and checks what comes back: the TSIG error
   * first (NOTAUTH + BADKEY is more telling than NOTAUTH), then the RCODE,
   * then the signature of the answer itself when there is one.
   */
  async function signedExchange(unsigned: Buffer, zone: string, operation: Operation): Promise<{ answer: DnsMessage; signed: boolean }> {
    const { message, mac } = tsigSign(unsigned, key, Math.floor(Date.now() / 1000))
    const raw = await exchange(message)
    const answer = parseAnswer(raw, message)
    const tsig = readTsig(raw, answer)

    if (tsig && tsig.error !== 0) throw new DnsProviderError(`${LABEL}: ${describeTsigError(tsig.error, keyName)}`)
    if (answer.rcode !== 0) throw new DnsProviderError(`${LABEL}: ${describeRcode(answer.rcode, operation, zone, keyName, where)}`)
    if (!tsig) return { answer, signed: false }

    // The answer as the server saw it before appending its TSIG: ARCOUNT one less, bytes up to the record.
    const body = Buffer.from(raw.subarray(0, tsig.record.offset))

    body.writeUInt16BE(answer.additional.length - 1, 10)

    const expected = tsigMac(key, body, tsig.timeSigned, tsig.fudge, tsig.error, tsig.other, mac)

    if (tsig.mac.length !== expected.length || !timingSafeEqual(tsig.mac, expected)) {
      throw new DnsProviderError(`${LABEL}: the answer of ${where} carries a TSIG signature that does not verify with key "${keyName}"`)
    }

    return { answer, signed: true }
  }

  async function zoneFor(fqdn: string): Promise<string> {
    const name = fqdn.replace(/\.$/, '').toLowerCase()

    if (pinnedZone) {
      relativeName(name, pinnedZone)

      return pinnedZone
    }

    const cached = zones.get(name)

    if (cached) return cached

    // The zone is the longest suffix the server answers an authoritative SOA
    // for, in the ANSWER section: a name below the apex gets its SOA in the
    // AUTHORITY section instead, which is not it.
    const outcomes: string[] = []

    for (const candidate of zoneCandidates(name)) {
      const query = buildSoaQuery(randomInt(0x10000), candidate)
      const answer = parseAnswer(await exchange(query), query)
      const authoritative = (answer.flags & FLAG_AA) !== 0

      if (authoritative && answer.answers.some(rr => rr.type === TYPE_SOA && rr.cls === CLASS_IN && rr.name === candidate)) {
        zones.set(name, candidate)

        return candidate
      }

      outcomes.push(`${candidate}: ${rcodeName(answer.rcode)}${authoritative ? '' : ', not authoritative'}`)
    }

    throw new DnsProviderError(`${LABEL}: ${where} serves no zone above ${fqdn} (${outcomes.join('; ')}); fill in the zone field if it should`)
  }

  return {
    async addTxtRecord(fqdn, value) {
      const zone = await zoneFor(fqdn)
      const { signed } = await signedExchange(buildTxtUpdate(randomInt(0x10000), zone, fqdn, value, 'add'), zone, 'update')

      // RFC 2136 §3.4.2.2: an RR already present is silently kept, so a retried add is fine.
      if (!signed) throw new DnsProviderError(`${LABEL}: ${where} accepted the update without signing its answer; an unsigned answer to a signed update is not trusted`)
    },

    async removeTxtRecord(fqdn, value) {
      const zone = await zoneFor(fqdn)

      // A value already gone is a no-op for the server too (§3.4.2.4).
      await signedExchange(buildTxtUpdate(randomInt(0x10000), zone, fqdn, value, 'delete'), zone, 'update')
    },

    /**
     * Proves that the server answers, that it is authoritative for the zone
     * and, where it validates TSIG on queries (BIND and Knot do, answering
     * BADKEY or BADSIG otherwise), that the key name, secret, algorithm and
     * clock all agree. What it cannot prove without writing is that the
     * update policy grants this key TXT records under `_acme-challenge`: the
     * first order tells, with REFUSED mapped to that policy.
     */
    async checkAccess(fqdn) {
      const zone = await zoneFor(fqdn)

      await signedExchange(buildSoaQuery(randomInt(0x10000), zone), zone, 'query')
    },
  }
}
