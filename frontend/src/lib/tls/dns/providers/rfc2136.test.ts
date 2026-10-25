import { createHmac } from 'node:crypto'
import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import { promises as dns } from 'node:dns'
import { createServer, type Server as TcpServer, type Socket as TcpSocket } from 'node:net'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  type DnsMessage,
  type DnsRecord,
  buildSoaQuery,
  buildTxtUpdate,
  createRfc2136Provider,
  encodeName,
  parseMessage,
  parseServer,
  readName,
  tsigSign,
  txtRdata,
} from '@/lib/tls/dns/providers/rfc2136'

const KEY_NAME = 'pc-acme'
const SECRET = Buffer.from('0123456789abcdef0123456789abcdef')
const SECRET_B64 = SECRET.toString('base64')
const ZONE = 'lab.example'
const NAME = `_acme-challenge.pc.${ZONE}`
const KEY = { name: KEY_NAME, algorithm: 'hmac-sha256', secret: SECRET }

const TYPE_SOA = 6
const TYPE_TXT = 16
const TYPE_TSIG = 250
const CLASS_IN = 1
const CLASS_NONE = 254
const FLAG_QR = 0x8000
const FLAG_AA = 0x0400
const FLAG_TC = 0x0200

// ---------------------------------------------------------------------------
// Independent wire helpers: the fake server judges the implementation's TSIG
// with its own bytes, not with the functions under test.

const be16 = (n: number) => Buffer.from([(n >> 8) & 0xff, n & 0xff])
const be32 = (n: number) => Buffer.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])
const be48 = (n: number) => Buffer.concat([be16(Math.floor(n / 2 ** 32)), be32(n % 2 ** 32)])

function wireName(name: string): Buffer {
  const labels = name.toLowerCase().split('.').filter(Boolean).map(label => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)]))

  return Buffer.concat([...labels, Buffer.from([0])])
}

function tsigVariables(timeSigned: number, fudge: number, error: number, other: Buffer): Buffer {
  return Buffer.concat([wireName(KEY_NAME), be16(255), be32(0), wireName('hmac-sha256'), be48(timeSigned), be16(fudge), be16(error), be16(other.length), other])
}

function hmacSha256(parts: Buffer[]): Buffer {
  const hmac = createHmac('sha256', SECRET)

  for (const part of parts) hmac.update(part)

  return hmac.digest()
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
}

/** Decodes TSIG RDATA by hand (names in there are never compressed). */
function decodeTsig(record: DnsRecord): TsigFields {
  const data = record.rdata
  const labels: string[] = []
  let at = 0

  while (data[at] !== 0) {
    labels.push(data.subarray(at + 1, at + 1 + data[at]).toString())
    at += 1 + data[at]
  }

  at += 1

  const timeSigned = data.readUInt16BE(at) * 2 ** 32 + data.readUInt32BE(at + 2)
  const fudge = data.readUInt16BE(at + 6)
  const macLength = data.readUInt16BE(at + 8)
  const mac = data.subarray(at + 10, at + 10 + macLength)

  at += 10 + macLength

  const originalId = data.readUInt16BE(at)
  const error = data.readUInt16BE(at + 2)
  const otherLength = data.readUInt16BE(at + 4)

  return { keyName: record.name, algorithm: labels.join('.'), timeSigned, fudge, mac, originalId, error, other: data.subarray(at + 6, at + 6 + otherLength) }
}

function soaRdata(): Buffer {
  return Buffer.concat([wireName(`ns1.${ZONE}`), wireName(`hostmaster.${ZONE}`), be32(2026102401), be32(3600), be32(600), be32(86400), be32(300)])
}

type Mode = 'ok' | 'refused' | 'badkey' | 'badsig' | 'truncate-udp' | 'unsigned-ok'

interface Received {
  via: 'udp' | 'tcp'
  message: DnsMessage
  tsig?: TsigFields
  macValid?: boolean
}

/**
 * A primary for lab.example on 127.0.0.1, same port on UDP and TCP, that
 * checks the TSIG of what it gets with the shared key and signs what it
 * sends back, the way BIND does.
 */
class FakePrimary {
  received: Received[] = []
  mode: Mode = 'ok'
  port = 0
  private udp!: UdpSocket
  private tcp!: TcpServer
  private connections = new Set<TcpSocket>()

  async start(): Promise<void> {
    for (let attempt = 0; attempt < 10 && !this.port; attempt++) {
      const udp = createSocket('udp4')

      await new Promise<void>((resolve, reject) => {
        udp.once('error', reject)
        udp.bind(0, '127.0.0.1', resolve)
      })

      const port = udp.address().port
      const tcp = createServer()
      const listening = await new Promise<boolean>(resolve => {
        tcp.once('error', () => resolve(false))
        tcp.listen(port, '127.0.0.1', () => resolve(true))
      })

      if (listening) {
        this.udp = udp
        this.tcp = tcp
        this.port = port
      } else {
        udp.close()
      }
    }

    if (!this.port) throw new Error('no port free on both UDP and TCP')

    this.udp.on('message', (raw, rinfo) => {
      const reply = this.handle(raw, 'udp')

      if (reply) this.udp.send(reply, rinfo.port, rinfo.address)
    })
    this.tcp.on('connection', connection => {
      let pending = Buffer.alloc(0)

      this.connections.add(connection)
      connection.on('close', () => this.connections.delete(connection))
      connection.on('data', chunk => {
        pending = Buffer.concat([pending, chunk])

        while (pending.length >= 2 && pending.length >= 2 + pending.readUInt16BE(0)) {
          const length = pending.readUInt16BE(0)
          const reply = this.handle(pending.subarray(2, 2 + length), 'tcp')

          pending = pending.subarray(2 + length)
          if (reply) connection.write(Buffer.concat([be16(reply.length), reply]))
        }
      })
    })
  }

  async stop(): Promise<void> {
    for (const connection of this.connections) connection.destroy()
    await new Promise<void>(resolve => this.udp.close(() => resolve()))
    await new Promise<void>(resolve => this.tcp.close(() => resolve()))
  }

  reset(mode: Mode = 'ok') {
    this.mode = mode
    this.received = []
  }

  private handle(raw: Buffer, via: 'udp' | 'tcp'): Buffer | undefined {
    const message = parseMessage(raw)
    const last = message.additional[message.additional.length - 1]
    const tsigRecord = last?.type === TYPE_TSIG ? last : undefined
    const tsig = tsigRecord ? decodeTsig(tsigRecord) : undefined
    let macValid: boolean | undefined

    if (tsig && tsigRecord) {
      const unsigned = Buffer.from(raw.subarray(0, tsigRecord.offset))

      unsigned.writeUInt16BE(message.additional.length - 1, 10)

      const expected = hmacSha256([unsigned, tsigVariables(tsig.timeSigned, tsig.fudge, tsig.error, tsig.other)])
      const fresh = Math.abs(tsig.timeSigned - Math.floor(Date.now() / 1000)) <= tsig.fudge

      macValid = tsig.keyName === KEY_NAME && tsig.algorithm === 'hmac-sha256' && tsig.originalId === message.id && fresh && expected.equals(tsig.mac)
    }

    this.received.push({ via, message, tsig, macValid })

    const reply = (rcode: number, answers: Buffer[] = [], extraFlags = FLAG_AA) => this.reply(message, rcode, answers, extraFlags)
    const signed = (body: Buffer, error = 0, withMac = true) => (tsig ? this.sign(body, tsig.mac, error, withMac) : body)
    const opcode = (message.flags >> 11) & 0xf

    if (opcode === 5) {
      if (!tsig) return reply(5)
      if (this.mode === 'truncate-udp' && via === 'udp') return reply(0, [], FLAG_AA | FLAG_TC)
      if (this.mode === 'badkey') return signed(reply(9), 17, false)
      if (this.mode === 'unsigned-ok') return reply(0)
      if (!macValid) return signed(reply(9), 16, false)

      return signed(reply(this.mode === 'refused' ? 5 : 0))
    }

    if (tsig && (this.mode === 'badsig' || !macValid)) return signed(reply(9), 16, false)

    const [question] = message.questions
    const answers = question?.name === ZONE && question.type === TYPE_SOA
      ? [Buffer.concat([Buffer.from([0xc0, 0x0c]), be16(TYPE_SOA), be16(CLASS_IN), be32(3600), be16(soaRdata().length), soaRdata()])]
      : []

    return signed(reply(answers.length > 0 ? 0 : 3, answers))
  }

  /** Header, the question (or zone) section echoed, the answers. */
  private reply(request: DnsMessage, rcode: number, answers: Buffer[], extraFlags: number): Buffer {
    const opcode = request.flags & 0x7800
    const questions = request.questions.map(q => Buffer.concat([wireName(q.name), be16(q.type), be16(q.cls)]))

    return Buffer.concat([
      be16(request.id), be16(FLAG_QR | opcode | extraFlags | rcode),
      be16(questions.length), be16(answers.length), be16(0), be16(0),
      ...questions, ...answers,
    ])
  }

  private sign(body: Buffer, requestMac: Buffer, error: number, withMac: boolean): Buffer {
    const timeSigned = Math.floor(Date.now() / 1000)
    const other = Buffer.alloc(0)
    const mac = withMac ? hmacSha256([be16(requestMac.length), requestMac, body, tsigVariables(timeSigned, 300, error, other)]) : Buffer.alloc(0)
    const rdata = Buffer.concat([wireName('hmac-sha256'), be48(timeSigned), be16(300), be16(mac.length), mac, body.subarray(0, 2), be16(error), be16(0)])
    const record = Buffer.concat([wireName(KEY_NAME), be16(TYPE_TSIG), be16(255), be32(0), be16(rdata.length), rdata])
    const out = Buffer.concat([body, record])

    out.writeUInt16BE(out.readUInt16BE(10) + 1, 10)

    return out
  }
}

// ---------------------------------------------------------------------------

describe('RFC 2136 message encoder', () => {
  it('writes a byte-exact UPDATE adding one TXT value', () => {
    const update = buildTxtUpdate(0x1234, ZONE, `_acme-challenge.${ZONE}`, 'hi', 'add')

    expect(update.toString('hex')).toBe([
      '1234', '2800', '0001', '0000', '0001', '0000',                       // id, opcode 5, ZOCOUNT 1, PRCOUNT 0, UPCOUNT 1, ADCOUNT 0
      '036c6162076578616d706c6500', '0006', '0001',                         // lab.example SOA IN
      '0f5f61636d652d6368616c6c656e6765036c6162076578616d706c6500',         // _acme-challenge.lab.example
      '0010', '0001', '0000003c', '0003', '026869',                         // TXT IN TTL 60, RDLENGTH 3, "hi"
    ].join(''))
  })

  it('deletes exactly one value: same RDATA, class NONE, TTL 0', () => {
    const update = buildTxtUpdate(0x1234, ZONE, `_acme-challenge.${ZONE}`, 'hi', 'delete')

    expect(update.toString('hex')).toBe([
      '1234', '2800', '0001', '0000', '0001', '0000',
      '036c6162076578616d706c6500', '0006', '0001',
      '0f5f61636d652d6368616c6c656e6765036c6162076578616d706c6500',
      '0010', '00fe', '00000000', '0003', '026869',
    ].join(''))
  })

  it('writes a SOA query with RD clear', () => {
    expect(buildSoaQuery(0xabcd, 'Lab.Example.').toString('hex')).toBe('abcd0000000100000000000003' + '6c6162' + '07' + '6578616d706c65' + '00' + '0006' + '0001')
  })

  it('splits a long TXT value into 255-byte character-strings', () => {
    const rdata = txtRdata('x'.repeat(300))

    expect(rdata.length).toBe(302)
    expect(rdata[0]).toBe(255)
    expect(rdata[256]).toBe(45)
    expect(txtRdata('').toString('hex')).toBe('00')
  })

  it('refuses labels that do not fit', () => {
    expect(() => encodeName(`${'a'.repeat(64)}.example`)).toThrow(/not a valid DNS name/)
    expect(encodeName('').toString('hex')).toBe('00')
  })
})

describe('TSIG', () => {
  it('signs with the MAC an independent HMAC computes over message and TSIG variables, at a fixed time', () => {
    const unsigned = buildTxtUpdate(0x4242, ZONE, NAME, 'value', 'add')
    const timeSigned = 1_777_000_000
    const { message, mac } = tsigSign(unsigned, KEY, timeSigned)
    const expected = hmacSha256([unsigned, tsigVariables(timeSigned, 300, 0, Buffer.alloc(0))])

    expect(mac.equals(expected)).toBe(true)

    // ARCOUNT went from 0 to 1 and the rest of the message is untouched.
    expect(message.readUInt16BE(10)).toBe(1)
    expect(message.subarray(0, 10).equals(unsigned.subarray(0, 10))).toBe(true)
    expect(message.subarray(12, unsigned.length).equals(unsigned.subarray(12))).toBe(true)

    // The TSIG RR: key name, type 250, class ANY, TTL 0, then the RDATA fields.
    const rr = message.subarray(unsigned.length)
    const rdata = Buffer.concat([wireName('hmac-sha256'), be48(timeSigned), be16(300), be16(32), expected, be16(0x4242), be16(0), be16(0)])

    expect(rr.equals(Buffer.concat([wireName(KEY_NAME), be16(TYPE_TSIG), be16(255), be32(0), be16(rdata.length), rdata]))).toBe(true)

    const parsed = parseMessage(message)
    const fields = decodeTsig(parsed.additional[0])

    expect(fields).toMatchObject({ keyName: KEY_NAME, algorithm: 'hmac-sha256', timeSigned, fudge: 300, originalId: 0x4242, error: 0 })
  })

  it('uses the digest the algorithm field names', () => {
    const unsigned = buildSoaQuery(1, ZONE)
    const { mac } = tsigSign(unsigned, { ...KEY, algorithm: 'hmac-sha512' }, 1_777_000_000)
    const variables = Buffer.concat([wireName(KEY_NAME), be16(255), be32(0), wireName('hmac-sha512'), be48(1_777_000_000), be16(300), be16(0), be16(0)])

    expect(mac.length).toBe(64)
    expect(mac.equals(createHmac('sha512', SECRET).update(unsigned).update(variables).digest())).toBe(true)
  })
})

describe('DNS message parser', () => {
  it('follows compression pointers, whole and after some labels', () => {
    const question = Buffer.concat([wireName(NAME), be16(TYPE_TXT), be16(CLASS_IN)])

    // The question name sits at offset 12: `_acme-challenge` (16 bytes) then `pc` at 28, `lab.example` at 31.
    const answer1 = Buffer.concat([Buffer.from([0xc0, 0x0c]), be16(TYPE_TXT), be16(CLASS_IN), be32(60), be16(3), Buffer.from([2, 0x68, 0x69])])
    const answer2 = Buffer.concat([Buffer.from([3, 0x77, 0x77, 0x77, 0xc0, 31]), be16(TYPE_TXT), be16(CLASS_IN), be32(60), be16(1), Buffer.from([0])])
    const raw = Buffer.concat([be16(7), be16(FLAG_QR | FLAG_AA), be16(1), be16(2), be16(0), be16(0), question, answer1, answer2])
    const parsed = parseMessage(raw)

    expect(parsed).toMatchObject({ id: 7, rcode: 0 })
    expect(parsed.questions).toEqual([{ name: NAME, type: TYPE_TXT, cls: CLASS_IN }])
    expect(parsed.answers.map(a => a.name)).toEqual([NAME, `www.${ZONE}`])
    expect(parsed.answers[0]).toMatchObject({ type: TYPE_TXT, cls: CLASS_IN, ttl: 60, offset: 12 + question.length })
    expect(parsed.answers[0].rdata.toString('hex')).toBe('026869')
    expect(parsed.answers[1].rdataOffset).toBe(raw.length - 1)
  })

  it('lowercases names and reports where the name ends', () => {
    const buffer = Buffer.concat([wireName('WWW.Example'), be16(1)])

    expect(readName(buffer, 0)).toEqual({ name: 'www.example', next: 13 })
  })

  it('rejects a pointer loop and a truncated message', () => {
    const loop = Buffer.concat([be16(1), be16(0), be16(1), be16(0), be16(0), be16(0), Buffer.from([0xc0, 0x0c]), be16(1), be16(1)])

    expect(() => parseMessage(loop)).toThrow(/pointer loop/)
    expect(() => parseMessage(Buffer.alloc(5))).toThrow(/shorter than a header/)
    expect(() => parseMessage(Buffer.concat([be16(1), be16(0), be16(1), be16(0), be16(0), be16(0), Buffer.from([3, 0x61])]))).toThrow(/past the end/)
  })
})

describe('server field', () => {
  it('accepts host, host:port, bracketed IPv6 and bare IPv6', () => {
    expect(parseServer('ns1.example.com')).toEqual({ host: 'ns1.example.com', port: 53 })
    expect(parseServer(' ns1.example.com:5353 ')).toEqual({ host: 'ns1.example.com', port: 5353 })
    expect(parseServer('[2001:db8::1]:5353')).toEqual({ host: '2001:db8::1', port: 5353 })
    expect(parseServer('[2001:db8::1]')).toEqual({ host: '2001:db8::1', port: 53 })
    expect(parseServer('2001:db8::1')).toEqual({ host: '2001:db8::1', port: 53 })
    expect(parseServer('10.42.0.101:53')).toEqual({ host: '10.42.0.101', port: 53 })
  })

  it('rejects what is not a server', () => {
    expect(() => parseServer('ns1:abc')).toThrow(/not a valid server/)
    expect(() => parseServer('ns1:70000')).toThrow(/not a valid server/)
    expect(() => parseServer(':53')).toThrow(/not a valid server/)
  })
})

describe('RFC 2136 provider against an in-process primary', () => {
  const primary = new FakePrimary()
  const credentials = () => ({ server: `127.0.0.1:${primary.port}`, keyName: KEY_NAME, keyAlgorithm: 'hmac-sha256', keySecret: SECRET_B64 })
  const provider = (extra: Record<string, string> = {}) => createRfc2136Provider({ ...credentials(), ...extra }, { fetch })

  beforeAll(() => primary.start())
  afterAll(() => primary.stop())
  beforeEach(() => {
    primary.reset()
  })

  it('finds the zone by SOA, then sends a signed ADD the server verifies', async () => {
    await provider().addTxtRecord(NAME, 'v1')

    const queries = primary.received.filter(r => ((r.message.flags >> 11) & 0xf) === 0)
    const [update] = primary.received.filter(r => ((r.message.flags >> 11) & 0xf) === 5)

    // Longest candidate first, stopping at the first authoritative SOA.
    expect(queries.map(q => q.message.questions[0].name)).toEqual([NAME, `pc.${ZONE}`, ZONE])
    expect(queries.every(q => q.tsig === undefined)).toBe(true)

    expect(update.via).toBe('udp')
    expect(update.macValid).toBe(true)
    expect(update.message.questions).toEqual([{ name: ZONE, type: TYPE_SOA, cls: CLASS_IN }])
    expect(update.message.authority).toHaveLength(1)
    expect(update.message.authority[0]).toMatchObject({ name: NAME, type: TYPE_TXT, cls: CLASS_IN, ttl: 60 })
    expect(update.message.authority[0].rdata.toString()).toBe('\u0002v1')
    expect(update.message.additional).toHaveLength(1)
  })

  it('reuses the discovered zone and deletes exactly one value', async () => {
    const p = provider()

    await p.addTxtRecord(NAME, 'v1')
    primary.reset()
    await p.removeTxtRecord(NAME, 'v1')

    expect(primary.received).toHaveLength(1)

    const [update] = primary.received

    expect(update.macValid).toBe(true)
    expect(update.message.authority[0]).toMatchObject({ name: NAME, type: TYPE_TXT, cls: CLASS_NONE, ttl: 0 })
    expect(update.message.authority[0].rdata.toString()).toBe('\u0002v1')
  })

  it('skips discovery with a pinned zone and refuses a name outside it', async () => {
    await provider({ zone: `${ZONE}.` }).addTxtRecord(NAME, 'v1')

    expect(primary.received).toHaveLength(1)
    expect(primary.received[0].message.questions[0].name).toBe(ZONE)

    await expect(provider({ zone: ZONE }).addTxtRecord('_acme-challenge.other.example', 'v1')).rejects.toThrow('_acme-challenge.other.example is not inside the zone lab.example')
  })

  it('explains REFUSED in terms of the update policy', async () => {
    primary.reset('refused')

    await expect(provider().addTxtRecord(NAME, 'v1'))
      .rejects.toThrow(`RFC 2136: 127.0.0.1:${primary.port} refused the update of lab.example (REFUSED): key "pc-acme" is not allowed to change TXT records there (allow-update / update-policy)`)
  })

  it('names an unknown key (BADKEY) without ever quoting the secret', async () => {
    primary.reset('badkey')

    const failure = await provider().addTxtRecord(NAME, 'v1').catch(err => err)

    expect(failure.message).toBe('RFC 2136: the server does not know the key "pc-acme" (BADKEY)')
    expect(failure.message).not.toContain(SECRET_B64)
  })

  it('maps a wrong secret to BADSIG on the access check', async () => {
    await expect(provider({ keySecret: Buffer.from('wrong-secret-wrong-secret-wrong!').toString('base64') }).checkAccess(NAME))
      .rejects.toThrow('RFC 2136: the server rejected the signature made with key "pc-acme" (BADSIG): the secret or the algorithm does not match')
    expect(primary.received.filter(r => r.tsig).every(r => r.macValid === false)).toBe(true)
  })

  it('falls back to TCP when the UDP answer is truncated', async () => {
    primary.reset('truncate-udp')

    await provider().addTxtRecord(NAME, 'v1')

    const updates = primary.received.filter(r => ((r.message.flags >> 11) & 0xf) === 5)

    expect(updates.map(u => u.via)).toEqual(['udp', 'tcp'])
    expect(updates[0].message.id).toBe(updates[1].message.id)
    expect(updates[1].macValid).toBe(true)
  })

  it('checks access with a signed SOA query the server verifies and signs back', async () => {
    await provider().checkAccess(NAME)

    const signedQueries = primary.received.filter(r => r.tsig)

    expect(signedQueries).toHaveLength(1)
    expect(signedQueries[0].message.questions[0]).toEqual({ name: ZONE, type: TYPE_SOA, cls: CLASS_IN })
    expect(signedQueries[0].macValid).toBe(true)
  })

  it('does not trust an unsigned answer to a signed update', async () => {
    primary.reset('unsigned-ok')

    await expect(provider().addTxtRecord(NAME, 'v1')).rejects.toThrow(/without signing its answer/)
  })

  it('says which candidates were tried when the server serves no zone above the name', async () => {
    await expect(provider().checkAccess('_acme-challenge.other.test'))
      .rejects.toThrow(`RFC 2136: 127.0.0.1:${primary.port} serves no zone above _acme-challenge.other.test (_acme-challenge.other.test: NXDOMAIN; other.test: NXDOMAIN); fill in the zone field if it should`)
  })

  it('refuses a secret that is not base64, an unknown algorithm and a missing field', () => {
    expect(() => provider({ keySecret: 'not base64!' })).toThrow(/the key secret is not base64/)
    expect(() => provider({ keyAlgorithm: 'hmac-md5' })).toThrow('RFC 2136: unsupported key algorithm "hmac-md5"')
    expect(() => createRfc2136Provider({ server: 'ns1' }, { fetch })).toThrow('RFC 2136: the "keyName" field is empty')
  })

  it('reports an unreachable server on both transports', async () => {
    const closed = createServer()

    await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve))

    const port = (closed.address() as { port: number }).port

    await new Promise<void>(resolve => closed.close(() => resolve()))

    const p = createRfc2136Provider({ ...credentials(), server: `127.0.0.1:${port}` }, { fetch })

    await expect(p.checkAccess(NAME)).rejects.toThrow(new RegExp(`RFC 2136: 127.0.0.1:${port} unreachable \\(udp: .*; tcp: .*\\)`))
  }, 15_000)
})

// Against a real primary (BIND, Knot, PowerDNS) configured with key pc-acme,
// hmac-sha256, the secret above, and zone lab.example updatable by that key:
//   PC_RFC2136_SERVER=127.0.0.1:15353 npx vitest run src/lib/tls/dns/providers/rfc2136.test.ts
describe.skipIf(!process.env.PC_RFC2136_SERVER)('RFC 2136 provider against a real primary', () => {
  const server = process.env.PC_RFC2136_SERVER ?? ''
  const credentials = { server, keyName: KEY_NAME, keyAlgorithm: 'hmac-sha256', keySecret: SECRET_B64 }
  const realName = `_acme-challenge.real.${ZONE}`

  async function txtAt(name: string): Promise<string[]> {
    const resolver = new dns.Resolver({ timeout: 2_000, tries: 1 })

    resolver.setServers([server])

    try {
      return (await resolver.resolveTxt(name)).map(chunks => chunks.join('')).sort()
    } catch (err: any) {
      if (['ENODATA', 'ENOTFOUND'].includes(err?.code)) return []
      throw err
    }
  }

  it('checks access, publishes two values, removes one then the other', async () => {
    const provider = createRfc2136Provider(credentials, { fetch })

    await provider.checkAccess(realName)
    await provider.addTxtRecord(realName, 'v1')
    await provider.addTxtRecord(realName, 'v2')
    await provider.addTxtRecord(realName, 'v1')
    expect(await txtAt(realName)).toEqual(['v1', 'v2'])

    await provider.removeTxtRecord(realName, 'v1')
    expect(await txtAt(realName)).toEqual(['v2'])

    await provider.removeTxtRecord(realName, 'v2')
    await provider.removeTxtRecord(realName, 'v2')
    expect(await txtAt(realName)).toEqual([])
  }, 30_000)

  it('gets BADKEY for an unknown key and BADSIG for a wrong secret', async () => {
    await expect(createRfc2136Provider({ ...credentials, keyName: 'nobody' }, { fetch }).checkAccess(realName)).rejects.toThrow(/BADKEY/)
    await expect(createRfc2136Provider({ ...credentials, keySecret: Buffer.from('wrong-secret-wrong-secret-wrong!').toString('base64') }, { fetch }).checkAccess(realName)).rejects.toThrow(/BADSIG/)
  }, 30_000)
})
