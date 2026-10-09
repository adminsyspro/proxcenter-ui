// src/lib/guestFileRestore/settings.ts
//
// Provider-level settings of the guest file restore feature, stored under one
// key of the settings table (tenant `default`, like the syslog forwarder).
// The row holds no secret.

import { z } from 'zod'

import { getSetting, setSetting } from '@/lib/db/settings'

import type { GuestFileRestoreSettings } from './types'
import { isHomePath } from './paths'

export const GUEST_FILE_RESTORE_SETTING_KEY = 'guest_file_restore'

const PROVIDER_TENANT = 'default'

const MIB = 1024 * 1024
const GIB = 1024 * MIB
const TIB = 1024 * GIB

export const guestFileRestoreSettingsSchema = z.object({
  agentEnabled: z.boolean().default(true),
  sshEnabled: z.boolean().default(true),
  agentMaxBytes: z.number().int().min(MIB).max(64 * GIB).default(GIB),
  agentParallelWrites: z.number().int().min(1).max(16).default(4),
  defaultConflict: z.enum(['keep', 'overwrite', 'skip']).default('keep'),
  restoredPrefix: z
    .string()
    .min(1)
    .max(32)
    .refine(v => !/[\\/]/.test(v), { message: 'The prefix cannot contain a path separator' })
    .default('RESTORED-'),
  defaultCustomDirLinux: z
    .string()
    .min(1)
    .max(1024)
    .refine(v => v.startsWith('/') || isHomePath(v), { message: 'Must be an absolute path or start with ~/' })
    // Under the home of the writing account: a world-writable default (/tmp)
    // would leave restored files readable by every account of the guest.
    .default('~/proxcenter-restore'),
  defaultCustomDirWindows: z
    .string()
    .min(1)
    .max(1024)
    .refine(v => /^[A-Za-z]:[\\/]/.test(v), { message: 'Must start with a drive letter, e.g. C:\\' })
    .default('C:\\ProxCenter-Restore'),
  sshConnectTimeoutSec: z.number().int().min(5).max(120).default(20),
  maxConcurrentJobs: z.number().int().min(1).max(20).default(3),
  jobRetentionDays: z.number().int().min(1).max(365).default(30),
  // Empty = <os.tmpdir()>/proxcenter-guest-restore. Only the agent method
  // spools (one file at a time); SSH streams straight into the guest.
  spoolDir: z
    .string()
    .trim()
    .max(1024)
    .refine(v => v === '' || v.startsWith('/'), { message: 'Must be an absolute path' })
    .default(''),
  spoolMinFreeBytes: z.number().int().min(0).max(TIB).default(2 * GIB),
  sourceStallTimeoutSec: z.number().int().min(10).max(3600).default(120),
})

export const DEFAULT_GUEST_FILE_RESTORE_SETTINGS: GuestFileRestoreSettings = guestFileRestoreSettingsSchema.parse({})

/** Parse whatever the settings row holds; a corrupt row yields the defaults, never a throw. */
export function parseGuestFileRestoreSettings(raw: unknown): GuestFileRestoreSettings {
  const parsed = guestFileRestoreSettingsSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : { ...DEFAULT_GUEST_FILE_RESTORE_SETTINGS }
}

export async function loadGuestFileRestoreSettings(): Promise<GuestFileRestoreSettings> {
  const raw = await getSetting<unknown>(GUEST_FILE_RESTORE_SETTING_KEY, PROVIDER_TENANT)
  return parseGuestFileRestoreSettings(raw)
}

export async function saveGuestFileRestoreSettings(input: unknown): Promise<GuestFileRestoreSettings> {
  const value = guestFileRestoreSettingsSchema.parse(input)
  await setSetting(GUEST_FILE_RESTORE_SETTING_KEY, PROVIDER_TENANT, value)
  return value
}
