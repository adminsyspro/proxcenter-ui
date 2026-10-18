/**
 * uploadFileToStorage: the browser side of the two-leg upload protocol. The
 * file goes up in 5 MiB chunks under one upload id, then a finalize call
 * hands it to PVE. Run with the unit config (no Postgres):
 *   npx vitest run --config vitest.unit.config.ts src/lib/storage/uploadClient.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UPLOAD_CHUNK_SIZE, uploadFileToStorage } from './uploadClient'

interface Call { headers: Record<string, string>; bodySize: number | null }

let calls: Call[]
let responses: Array<{ status: number; body?: unknown; json?: boolean }>

/** A File stand-in: only what the client reads (size, name, type, slice). */
function fakeFile(size: number, name = 'debian.iso', type = ''): File {
  return {
    size,
    name,
    type,
    slice: (start: number, end: number) => ({ size: end - start }),
  } as unknown as File
}

beforeEach(() => {
  calls = []
  responses = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
    calls.push({ headers: init.headers, bodySize: init.body ? init.body.size : null })
    const next = responses.shift() ?? { status: 200, body: {} }
    return {
      ok: next.status < 400,
      status: next.status,
      json: async () => {
        if (next.json === false) throw new Error('not json')
        return next.body ?? {}
      },
    }
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const ARGS = { connId: 'c 1', node: 'pve1', storage: 'iso-lib' }

describe('uploadFileToStorage', () => {
  it('uploads the file in 5 MiB chunks under one id, then finalizes, reporting progress and phases', async () => {
    const progress: number[] = []
    const phases: string[] = []
    responses = [{ status: 200 }, { status: 200 }, { status: 200 }, { status: 200, body: { filename: 'acme__debian.iso' } }]

    const result = await uploadFileToStorage({
      ...ARGS,
      file: fakeFile(2 * UPLOAD_CHUNK_SIZE + 10),
      onProgress: (p) => progress.push(p),
      onPhase: (p) => phases.push(p),
    })

    expect(calls).toHaveLength(4)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/v1/connections/c%201/nodes/pve1/storage/iso-lib/upload')
    // Three chunks: two full ones and the tail, every header the route reads.
    expect(calls.slice(0, 3).map((c) => c.headers['X-Chunk-Index'])).toEqual(['0', '1', '2'])
    expect(calls.slice(0, 3).map((c) => c.bodySize)).toEqual([UPLOAD_CHUNK_SIZE, UPLOAD_CHUNK_SIZE, 10])
    expect(calls[0].headers).toMatchObject({
      'X-Total-Chunks': '3',
      'X-Total-Size': String(2 * UPLOAD_CHUNK_SIZE + 10),
      'X-File-Name': 'debian.iso',
      'X-Content-Type': 'iso',
      'X-Mime-Type': 'application/octet-stream',
    })
    const id = calls[0].headers['X-Upload-Id']
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(calls.every((c) => c.headers['X-Upload-Id'] === id)).toBe(true)
    // The finalize leg carries the id and nothing else.
    expect(calls[3].headers).toEqual({ 'X-Upload-Id': id, 'X-Finalize': '1' })
    expect(calls[3].bodySize).toBeNull()

    expect(progress).toEqual([33, 67, 100])
    expect(phases).toEqual(['uploading', 'transferring'])
    expect(result).toEqual({ uploadId: id, filename: 'acme__debian.iso' })
  })

  it('reuses a given upload id, content and mime types, and keeps the file name when the server returns none', async () => {
    responses = [{ status: 200 }, { status: 200, body: {} }]
    const result = await uploadFileToStorage({
      ...ARGS,
      file: fakeFile(1, 'alpine.tar.gz', 'application/gzip'),
      uploadId: 'u-1',
      contentType: 'vztmpl',
    })
    expect(calls).toHaveLength(2)
    expect(calls[0].headers).toMatchObject({ 'X-Upload-Id': 'u-1', 'X-Content-Type': 'vztmpl', 'X-Mime-Type': 'application/gzip', 'X-Total-Chunks': '1' })
    expect(result).toEqual({ uploadId: 'u-1', filename: 'alpine.tar.gz' })
  })

  it('sends one chunk for an empty file', async () => {
    responses = [{ status: 200 }, { status: 200, body: { filename: 'empty.iso' } }]
    await uploadFileToStorage({ ...ARGS, file: fakeFile(0, 'empty.iso') })
    expect(calls[0].headers['X-Total-Chunks']).toBe('1')
    expect(calls[0].bodySize).toBe(0)
  })

  it('surfaces the server message of a refused chunk, and a generic one when the body is not JSON', async () => {
    responses = [{ status: 413, body: { error: 'File too large for this storage' } }]
    await expect(uploadFileToStorage({ ...ARGS, file: fakeFile(10) })).rejects.toThrow('File too large for this storage')
    expect(calls).toHaveLength(1)

    calls = []
    responses = [{ status: 200 }, { status: 500, json: false }]
    await expect(uploadFileToStorage({ ...ARGS, file: fakeFile(10) })).rejects.toThrow('Finalize failed: HTTP 500')
    expect(calls).toHaveLength(2)
  })

  it('still draws its id from a CSPRNG when randomUUID is missing', async () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.fill(0xab) })
    responses = [{ status: 200 }, { status: 200 }]
    const { uploadId } = await uploadFileToStorage({ ...ARGS, file: fakeFile(10) })
    expect(uploadId).toMatch(/^\d+-(ab){16}$/)
  })

  describe('behind a reverse proxy that gives up first (roadmap#55)', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('sends a chunk again after a proxy 504 or a network error, with its body', async () => {
      responses = [{ status: 504, json: false }, { status: 200 }, { status: 200 }]
      vi.mocked(fetch).mockImplementationOnce(async () => { throw new TypeError('Failed to fetch') })

      const done = uploadFileToStorage({ ...ARGS, file: fakeFile(10) })
      await vi.runAllTimersAsync()
      await done

      // network error, 504, then the accepted chunk, then finalize
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4)
      expect(calls.map((c) => c.headers['X-Chunk-Index'])).toEqual(['0', '0', undefined])
      expect(calls.slice(0, 2).map((c) => c.bodySize)).toEqual([10, 10])
    })

    it('asks again without the body after a 202, the server already holding the chunk', async () => {
      responses = [{ status: 202 }, { status: 202 }, { status: 200 }, { status: 200 }]

      await uploadFileToStorage({ ...ARGS, file: fakeFile(10) })

      expect(calls.map((c) => c.bodySize)).toEqual([10, null, null, null])
      expect(calls.slice(0, 3).every((c) => c.headers['X-Chunk-Index'] === '0')).toBe(true)
    })

    it('gives up after four retries and reports the last status', async () => {
      responses = Array.from({ length: 5 }, () => ({ status: 504, json: false }))

      const done = uploadFileToStorage({ ...ARGS, file: fakeFile(10) })
      const outcome = expect(done).rejects.toThrow('Chunk 0 failed: HTTP 504')
      await vi.runAllTimersAsync()
      await outcome
      expect(calls).toHaveLength(5)
    })

    it('does not retry a refusal of the route itself', async () => {
      responses = [{ status: 409, body: { error: 'The upload was interrupted on the server side. Start it again.' } }]

      await expect(uploadFileToStorage({ ...ARGS, file: fakeFile(10) })).rejects.toThrow('interrupted on the server side')
      expect(calls).toHaveLength(1)
    })

    it('stops waiting between retries as soon as the upload is aborted', async () => {
      responses = [{ status: 504, json: false }]
      const ctrl = new AbortController()

      const done = uploadFileToStorage({ ...ARGS, file: fakeFile(10), signal: ctrl.signal })
      const outcome = expect(done).rejects.toThrow('stopped')
      await vi.advanceTimersByTimeAsync(10)
      ctrl.abort(new Error('stopped'))
      await outcome
      expect(calls).toHaveLength(1)
    })
  })
})
