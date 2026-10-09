// src/lib/guestFileRestore/schemas.ts
//
// zod validation of the request bodies. Every user path is checked here
// before it reaches a download URL or a guest command.

import { NextResponse } from 'next/server'
import { z } from 'zod'

import { PXAR_SUFFIX, hasParentSegment, isHomePath, isRestorableItemPath } from './paths'

const ID = z.string().trim().min(1).max(64)

/** Absolute posix path with no `..` segment and no NUL. */
function safeSourcePath(p: string): boolean {
  return p.startsWith('/') && !hasParentSegment(p) && !p.includes('\0')
}

/** Guest folder: absolute on either OS (`/srv/x` or `C:\x`) or `~/x` (home of the writing account), no `..`. */
function safeGuestDir(p: string): boolean {
  return (/^(\/|[A-Za-z]:[\\/])/.test(p) || isHomePath(p)) && !hasParentSegment(p) && !p.includes('\0')
}

export const guestRestoreSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pve'),
    connId: ID,
    storage: z.string().trim().min(1).max(128),
    volume: z.string().trim().min(1).max(512),
  }),
  z.object({
    kind: z.literal('pbs'),
    pbsId: ID,
    datastore: z.string().trim().min(1).max(64),
    namespace: z.string().trim().max(256).optional(),
    backupType: z.enum(['vm', 'ct', 'host']),
    backupId: z.string().trim().min(1).max(128),
    backupTime: z.number().int().positive(),
    archive: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .refine(a => a.endsWith(PXAR_SUFFIX) && !a.includes('/'), { message: 'Only pxar archives can be restored from PBS directly' }),
  }),
])

export const guestRestoreItemSchema = z.object({
  path: z.string().min(1).max(4096).refine(safeSourcePath, { message: 'Invalid path' }),
  directory: z.boolean(),
  size: z.number().int().nonnegative().optional(),
})

export const guestRestoreTargetSchema = z.object({
  connId: ID,
  node: z.string().trim().min(1).max(128),
  type: z.enum(['qemu', 'lxc']),
  vmid: z.number().int().min(1).max(999_999_999),
})

/** OpenSSH-style host key fingerprint: `SHA256:` + unpadded base64 of 32 bytes. */
export const hostKeyFingerprintSchema = z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/, { message: 'Invalid host key fingerprint' })

const sshFieldsSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().trim().min(1).max(128),
  password: z.string().max(4096).optional(),
  privateKey: z.string().max(16384).optional(),
  passphrase: z.string().max(4096).optional(),
  hostKeyFingerprint: hostKeyFingerprintSchema.optional(),
})

const hasAuth = (s: { password?: string; privateKey?: string }) => Boolean(s.password) || Boolean(s.privateKey)
const AUTH_MESSAGE = { message: 'A password or a private key is required' }

/** Probe: no fingerprint yet, the probe reports it. */
export const guestRestoreSshSchema = sshFieldsSchema.refine(hasAuth, AUTH_MESSAGE)

/** Job: the fingerprint confirmed in the dialog is required. */
export const guestRestoreSshPinnedSchema = sshFieldsSchema
  .extend({ hostKeyFingerprint: hostKeyFingerprintSchema })
  .refine(hasAuth, AUTH_MESSAGE)

export const guestRestoreDestinationSchema = z.object({
  mode: z.enum(['original', 'custom']),
  path: z.string().trim().max(4096).refine(p => p === '' || safeGuestDir(p), { message: 'Invalid folder' }).optional(),
  windowsDrive: z.string().regex(/^[A-Za-z]$/).optional(),
})

export const guestRestoreMethodSchema = z.enum(['agent', 'ssh'])
export const guestRestoreConflictSchema = z.enum(['keep', 'overwrite', 'skip'])

export const probeRequestSchema = z.object({
  target: guestRestoreTargetSchema,
  method: guestRestoreMethodSchema,
  ssh: guestRestoreSshSchema.optional(),
})

export const createJobRequestSchema = z.object({
  source: guestRestoreSourceSchema,
  items: z.array(guestRestoreItemSchema).min(1).max(200),
  target: guestRestoreTargetSchema,
  method: guestRestoreMethodSchema,
  destination: guestRestoreDestinationSchema,
  conflict: guestRestoreConflictSchema.optional(),
  ssh: guestRestoreSshPinnedSchema.optional(),
}).superRefine((body, ctx) => {
  body.items.forEach((item, i) => {
    if (!isRestorableItemPath(body.source.kind, item.path)) {
      ctx.addIssue({
        code: 'custom',
        path: ['items', i, 'path'],
        message: 'Pick files or folders inside a filesystem, not a whole disk, partition or archive',
      })
    }
  })
})

export const listJobsQuerySchema = z.object({
  connId: ID.optional(),
  vmid: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export function validationError(error: z.ZodError, message = 'Invalid request'): Response {
  return NextResponse.json(
    {
      error: message,
      issues: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    },
    { status: 400 },
  )
}
