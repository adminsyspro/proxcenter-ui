import { generateKeyPairSync } from 'node:crypto'
import type { AddressInfo } from 'node:net'

import { Server } from 'ssh2'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { HOST_KEY_MISMATCH_MESSAGE, classifySshError, connectSsh, hostKeyMatches, sshFingerprint } from './ssh'
import { GuestWriterError } from './writer'

// An in-process SSH server with a throwaway host key: password `ok` is
// accepted, anything else refused. Enough to exercise the per-job host key
// pinning and the error classification against a real handshake.
let server: Server
let port = 0

beforeAll(async () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  })
  server = new Server({ hostKeys: [privateKey] }, client => {
    client.on('authentication', ctx => {
      if (ctx.method === 'password' && ctx.password === 'ok') ctx.accept()
      else ctx.reject(['password'])
    })
    client.on('error', () => {})
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
})

const creds = { host: '127.0.0.1', username: 'root', password: 'ok' }

describe('sshFingerprint / hostKeyMatches', () => {
  it('formats an OpenSSH SHA256 fingerprint and compares it', () => {
    const key = Buffer.from('some public key blob')
    const fp = sshFingerprint(key)
    expect(fp).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
    expect(hostKeyMatches(key, fp)).toBe(true)
    expect(hostKeyMatches(key, ` ${fp} `)).toBe(true)
    expect(hostKeyMatches(key, 'SHA256:' + 'x'.repeat(43))).toBe(false)
  })
})

describe('classifySshError', () => {
  it('maps raw errors to a generic class', () => {
    expect(classifySshError(new Error('All configured authentication methods failed'))).toMatchObject({ errorClass: 'auth_failed' })
    expect(classifySshError(new Error('connect ECONNREFUSED 10.0.0.5:22'))).toMatchObject({ errorClass: 'unreachable' })
    expect(classifySshError(new Error('Timed out while waiting for handshake'))).toMatchObject({ errorClass: 'timeout' })
    expect(classifySshError(new Error(`${HOST_KEY_MISMATCH_MESSAGE} (presented a, expected b)`))).toEqual({ errorClass: 'host_key', message: HOST_KEY_MISMATCH_MESSAGE })
    expect(classifySshError(new Error('Unsupported guest OS over SSH: nothing answered'))).toMatchObject({ errorClass: 'unsupported_os' })
    const other = classifySshError(new Error('weird internal detail 0x1234'))
    expect(other).toEqual({ errorClass: 'error', message: 'SSH connection failed' })
    expect(other.message).not.toContain('0x1234')
  })
})

describe('connectSsh host key pinning', () => {
  it('reports the fingerprint when none is expected (probe)', async () => {
    const conn = await connectSsh({ ...creds, port }, 5_000)
    conn.client.end()
    expect(conn.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
  })

  it('connects when the presented key matches the confirmed fingerprint', async () => {
    const probe = await connectSsh({ ...creds, port }, 5_000)
    probe.client.end()
    const job = await connectSsh({ ...creds, port }, 5_000, probe.fingerprint)
    job.client.end()
    expect(job.fingerprint).toBe(probe.fingerprint)
  })

  it('refuses a host whose key differs from the confirmed fingerprint', async () => {
    const err = await connectSsh({ ...creds, port }, 5_000, 'SHA256:' + 'A'.repeat(43)).catch(e => e)
    expect(err).toBeInstanceOf(GuestWriterError)
    expect(err.fatal).toBe(true)
    expect(err.message).toContain(HOST_KEY_MISMATCH_MESSAGE)
    expect(classifySshError(err)).toMatchObject({ errorClass: 'host_key' })
  })

  it('classifies a refused password as an authentication failure', async () => {
    const err = await connectSsh({ ...creds, port, password: 'wrong' }, 5_000).catch(e => e)
    expect(err).toBeInstanceOf(GuestWriterError)
    expect(classifySshError(err)).toMatchObject({ errorClass: 'auth_failed' })
  })

  it('classifies a closed port as unreachable', async () => {
    const err = await connectSsh({ ...creds, port: 1 }, 5_000).catch(e => e)
    expect(classifySshError(err)).toMatchObject({ errorClass: 'unreachable' })
  })
})
