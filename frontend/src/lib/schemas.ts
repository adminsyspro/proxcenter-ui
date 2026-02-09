// src/lib/schemas.ts
// Zod validation schemas for API route inputs

import { z } from 'zod'

// ─── Connections ───────────────────────────────────────────────────────────────

/** POST /api/v1/connections — create a Proxmox connection */
export const createConnectionSchema = z.object({
  name: z.string().min(1, 'name is required').transform(s => s.trim()),
  type: z.enum(['pve', 'pbs']).default('pve'),
  baseUrl: z.string().min(1, 'baseUrl is required').transform(s => s.trim()),
  uiUrl: z.string().transform(s => s.trim()).nullable().optional(),
  insecureTLS: z.boolean().default(false),
  hasCeph: z.boolean().default(false),
  apiToken: z.string().min(1, 'apiToken is required').transform(s => s.trim()),

  // SSH fields
  sshEnabled: z.boolean().default(false),
  sshPort: z.number().int().min(1).max(65535).default(22),
  sshUser: z.string().transform(s => s.trim()).default('root'),
  sshAuthMethod: z.enum(['key', 'password']).nullable().optional(),
  sshKey: z.string().transform(s => s.trim()).nullable().optional(),
  sshPassphrase: z.string().transform(s => s.trim()).nullable().optional(),
  sshPassword: z.string().transform(s => s.trim()).nullable().optional(),
}).superRefine((data, ctx) => {
  if (data.sshEnabled) {
    if (!data.sshAuthMethod) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sshAuthMethod must be 'key' or 'password' when SSH is enabled",
        path: ['sshAuthMethod'],
      })
    }
    if (data.sshAuthMethod === 'key' && !data.sshKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sshKey is required when sshAuthMethod is 'key'",
        path: ['sshKey'],
      })
    }
    if (data.sshAuthMethod === 'password' && !data.sshPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sshPassword is required when sshAuthMethod is 'password'",
        path: ['sshPassword'],
      })
    }
  }
})

/** PATCH /api/v1/connections/[id] — update a connection (all fields optional) */
export const updateConnectionSchema = z.object({
  name: z.string().min(1).transform(s => s.trim()).optional(),
  type: z.enum(['pve', 'pbs']).optional(),
  baseUrl: z.string().min(1).transform(s => s.trim()).optional(),
  uiUrl: z.string().transform(s => s.trim()).nullable().optional(),
  insecureTLS: z.boolean().optional(),
  hasCeph: z.boolean().optional(),
  apiToken: z.string().transform(s => s.trim()).optional(),

  // SSH fields
  sshEnabled: z.boolean().optional(),
  sshPort: z.number().int().min(1).max(65535).optional(),
  sshUser: z.string().transform(s => s.trim()).optional(),
  sshAuthMethod: z.enum(['key', 'password']).nullable().optional(),
  sshKey: z.string().transform(s => s.trim()).nullable().optional(),
  sshPassphrase: z.string().transform(s => s.trim()).nullable().optional(),
  sshPassword: z.string().transform(s => s.trim()).nullable().optional(),
})

// ─── Alerts ────────────────────────────────────────────────────────────────────

/** POST /api/v1/alerts — create / upsert an alert */
export const createAlertSchema = z.object({
  severity: z.string().min(1, 'severity is required'),
  message: z.string().min(1, 'message is required'),
  source: z.string().min(1, 'source is required'),
  sourceType: z.string().optional(),
  entityType: z.string().nullable().optional(),
  entityId: z.string().nullable().optional(),
  entityName: z.string().nullable().optional(),
  metric: z.string().nullable().optional(),
  currentValue: z.number().nullable().optional(),
  threshold: z.number().nullable().optional(),
})

/** PATCH /api/v1/alerts — batch update alert statuses */
export const patchAlertsSchema = z.object({
  ids: z.array(z.string()).min(1, 'ids array is required'),
  action: z.enum(['acknowledge', 'resolve', 'reopen']),
  userId: z.string().optional(),
})

/** Single alert item inside the sync array */
const syncAlertItemSchema = z.object({
  severity: z.string().min(1),
  message: z.string().min(1),
  source: z.string().min(1),
  sourceType: z.string().optional(),
  entityType: z.string().nullable().optional(),
  entityId: z.string().nullable().optional(),
  entityName: z.string().nullable().optional(),
  metric: z.string().nullable().optional(),
  currentValue: z.number().nullable().optional(),
  threshold: z.number().nullable().optional(),
})

/** POST /api/v1/alerts/sync — bulk sync alerts */
export const syncAlertsSchema = z.object({
  alerts: z.array(syncAlertItemSchema),
})

// ─── VM / CT operations ────────────────────────────────────────────────────────

/** POST .../clone — clone a VM or container */
export const cloneVmSchema = z.object({
  newid: z.union([z.number().int().min(100), z.string().min(1)])
    .transform(v => Number(v)),
  // All other Proxmox clone params are optional and passed through
  name: z.string().optional(),
  description: z.string().optional(),
  pool: z.string().optional(),
  snapname: z.string().optional(),
  storage: z.string().optional(),
  format: z.enum(['raw', 'qcow2', 'vmdk']).optional(),
  full: z.union([z.boolean(), z.number()]).optional(),
  target: z.string().optional(),
}).passthrough() // allow extra Proxmox params to pass through

/** POST .../migrate — migrate a VM or container */
export const migrateVmSchema = z.object({
  target: z.string().min(1, 'Target node is required'),
  online: z.boolean().default(true),
  targetstorage: z.string().optional(),
  withLocalDisks: z.boolean().optional(),
})

/** POST .../disk/resize — resize a disk */
export const resizeDiskSchema = z.object({
  disk: z.string().min(1, 'Disk name is required (e.g., scsi0)'),
  size: z.string().min(1, 'Size is required (e.g., +10G)'),
})

/** POST .../disk/move — move a disk to another storage */
export const moveDiskSchema = z.object({
  disk: z.string().min(1, 'Disk name is required (e.g., scsi0)'),
  storage: z.string().min(1, 'Target storage is required'),
  deleteSource: z.boolean().default(true),
  format: z.string().optional(),
})
