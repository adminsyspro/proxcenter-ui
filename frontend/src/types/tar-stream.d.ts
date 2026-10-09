// Minimal typings for tar-stream 2.x (no @types package in the tree). Only
// the surface used by the guest file restore reader and its tests.
declare module 'tar-stream' {
  import type { Readable, Writable } from 'node:stream'

  export type TarEntryType =
    | 'file'
    | 'link'
    | 'symlink'
    | 'character-device'
    | 'block-device'
    | 'directory'
    | 'fifo'
    | 'contiguous-file'
    | 'pax-header'
    | 'pax-global-header'
    | 'gnu-long-link-path'
    | 'gnu-long-path'
    | null

  export interface Headers {
    name: string
    mode?: number
    uid?: number
    gid?: number
    size?: number
    mtime?: Date
    linkname?: string | null
    type?: TarEntryType
    uname?: string
    gname?: string
    devmajor?: number
    devminor?: number
  }

  export interface Extract extends Writable {
    on(event: 'entry', listener: (header: Headers, stream: Readable, next: (err?: Error) => void) => void): this
    on(event: 'finish', listener: () => void): this
    on(event: 'error', listener: (err: Error) => void): this
    on(event: string, listener: (...args: any[]) => void): this
  }

  export interface Pack extends Readable {
    entry(headers: Headers, callback?: (err?: Error) => void): Writable
    entry(headers: Headers, buffer: string | Buffer, callback?: (err?: Error) => void): Writable
    finalize(): void
  }

  export function extract(options?: Record<string, unknown>): Extract
  export function pack(options?: Record<string, unknown>): Pack
}
