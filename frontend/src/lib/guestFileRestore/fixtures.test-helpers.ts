// Test helpers: build the tar.zst a file-restore download produces for a
// directory, with the same naming as PVE/PBS (`<basename>/...`).

import { Readable } from 'node:stream'
import { createZstdCompress } from 'node:zlib'

import * as tar from 'tar-stream'

export interface FixtureEntry {
  name: string
  type?: 'file' | 'directory' | 'symlink' | 'link'
  content?: string | Buffer
  mode?: number
  uid?: number
  gid?: number
  mtime?: Date
  linkname?: string
}

export async function buildTarZst(entries: FixtureEntry[]): Promise<Buffer> {
  const pack = tar.pack()
  for (const e of entries) {
    const headers: tar.Headers = {
      name: e.name,
      type: e.type ?? 'file',
      mode: e.mode,
      uid: e.uid,
      gid: e.gid,
      mtime: e.mtime,
      linkname: e.linkname,
    }
    if ((e.type ?? 'file') === 'file') {
      const content = typeof e.content === 'string' ? Buffer.from(e.content) : e.content ?? Buffer.alloc(0)
      pack.entry({ ...headers, size: content.length }, content)
    } else {
      pack.entry(headers)
    }
  }
  pack.finalize()
  const zstd = createZstdCompress()
  pack.pipe(zstd)
  const chunks: Buffer[] = []
  for await (const chunk of zstd) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

export async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

export function streamOf(buf: Buffer, chunkSize = 1024): Readable {
  const pieces: Buffer[] = []
  for (let i = 0; i < buf.length; i += chunkSize) pieces.push(buf.subarray(i, i + chunkSize))
  return Readable.from(pieces)
}
