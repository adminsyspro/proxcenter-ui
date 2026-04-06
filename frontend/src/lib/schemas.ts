// src/lib/schemas.ts
// Zod validation schemas for API route inputs

import { z } from 'zod'

// ─── Connections ───────────────────────────────────────────────────────────────

/** POST /api/v1/connections — create a Proxmox connection */
export const createConnectionSchema = z.object({
  name: z.string().min(1, 'name is required').transform(s => s.trim()),
  type: z.enum(['pve', 'pbs', 'vmware', 'xcpng', 'hyperv', 'nutanix']).default('pve'),
  baseUrl: z.string().min(1, 'baseUrl is required').transform(s => s.trim().replace(/\/+$/, '')),
  behindProxy: z.boolean().default(false),
  insecureTLS: z.boolean().default(false),
  hasCeph: z.boolean().default(false),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  locationLabel: z.string().nullable().optional(),
  apiToken: z.string().transform(s => s.trim()).optional().default(''),

  // VMware ESXi fields
  subType: z.enum(['esxi', 'vcenter']).optional(),
  vmwareUser: z.string().transform(s => s.trim()).optional().default(''),
  vmwarePassword: z.string().optional().default(''),
  vmwareDatacenter: z.string().transform(s => s.trim()).optional().default(''),

  // Hyper-V fields
  hypervShareName: z.string().transform(s => s.trim()).optional().default('VMs'),

  // SSH fields
  sshEnabled: z.boolean().default(false),
  sshPort: z.number().int().min(1).max(65535).default(22),
  sshUser: z.string().transform(s => s.trim()).default('root'),
  sshAuthMethod: z.enum(['key', 'password']).nullable().optional(),
  sshKey: z.nullable(z.string().transform(s => s.trim())).optional(),
  sshPassphrase: z.nullable(z.string().transform(s => s.trim())).optional(),
  sshPassword: z.nullable(z.string().transform(s => s.trim())).optional(),
  sshUseSudo: z.boolean().default(false),
}).superRefine((data, ctx) => {
  // PVE/PBS require apiToken
  if ((data.type === 'pve' || data.type === 'pbs') && !data.apiToken) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'apiToken is required for PVE/PBS connections',
      path: ['apiToken'],
    })
  }
  // VMware requires username + password
  if (data.type === 'vmware') {
    if (!data.vmwareUser) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'vmwareUser is required', path: ['vmwareUser'] })
    }
    if (!data.vmwarePassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'vmwarePassword is required', path: ['vmwarePassword'] })
    }
  }
  // Hyper-V requires username + password
  if (data.type === 'hyperv') {
    if (!data.vmwareUser) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Hyper-V username is required', path: ['vmwareUser'] })
    }
    if (!data.vmwarePassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Hyper-V password is required', path: ['vmwarePassword'] })
    }
  }
  // XCP-ng (XO) requires username + password
  if (data.type === 'xcpng') {
    if (!data.vmwareUser) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'XO username is required', path: ['vmwareUser'] })
    }
    if (!data.vmwarePassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'XO password is required', path: ['vmwarePassword'] })
    }
  }
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
  type: z.enum(['pve', 'pbs', 'vmware', 'xcpng', 'hyperv', 'nutanix']).optional(),
  baseUrl: z.string().min(1).transform(s => s.trim().replace(/\/+$/, '')).optional(),
  behindProxy: z.boolean().optional(),
  insecureTLS: z.boolean().optional(),
  hasCeph: z.boolean().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  locationLabel: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
  apiToken: z.string().transform(s => s.trim()).optional(),

  // VMware ESXi fields
  subType: z.enum(['esxi', 'vcenter']).nullable().optional(),
  vmwareUser: z.string().transform(s => s.trim()).optional(),
  vmwarePassword: z.string().optional(),
  vmwareDatacenter: z.string().transform(s => s.trim()).nullable().optional(),

  // SSH fields
  sshEnabled: z.boolean().optional(),
  sshPort: z.number().int().min(1).max(65535).optional(),
  sshUser: z.string().transform(s => s.trim()).optional(),
  sshAuthMethod: z.enum(['key', 'password']).nullable().optional(),
  sshKey: z.nullable(z.string().transform(s => s.trim())).optional(),
  sshPassphrase: z.nullable(z.string().transform(s => s.trim())).optional(),
  sshPassword: z.nullable(z.string().transform(s => s.trim())).optional(),
  sshUseSudo: z.boolean().optional(),
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

// ─── Custom Images ──────────────────────────────────────────────────────────

/** POST /api/v1/templates/custom-images — create a custom image */
export const createCustomImageSchema = z.object({
  name: z.string().min(1, 'name is required').max(100).transform(s => s.trim()),
  vendor: z.string().max(50).default('custom').transform(s => s.trim()),
  version: z.string().max(50).default('').transform(s => s.trim()),
  arch: z.string().max(20).default('amd64').transform(s => s.trim()),
  format: z.enum(['qcow2', 'raw', 'vmdk', 'img']).default('qcow2'),
  sourceType: z.enum(['url', 'volume']),
  downloadUrl: z.string().url().nullable().optional(),
  checksumUrl: z.string().url().nullable().optional(),
  volumeId: z.string().max(200).nullable().optional(),
  defaultDiskSize: z.string().regex(/^\d+G$/, 'Must be like "20G"').default('20G'),
  minMemory: z.number().int().min(128).max(1048576).default(512),
  recommendedMemory: z.number().int().min(128).max(1048576).default(2048),
  minCores: z.number().int().min(1).max(128).default(1),
  recommendedCores: z.number().int().min(1).max(128).default(2),
  ostype: z.string().max(20).default('l26'),
  tags: z.string().max(200).nullable().optional(),
}).superRefine((data, ctx) => {
  if (data.sourceType === 'url' && !data.downloadUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'downloadUrl is required when sourceType is "url"',
      path: ['downloadUrl'],
    })
  }
  if (data.sourceType === 'volume' && !data.volumeId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'volumeId is required when sourceType is "volume"',
      path: ['volumeId'],
    })
  }
})

/** PUT /api/v1/templates/custom-images/[id] — update a custom image */
export const updateCustomImageSchema = z.object({
  name: z.string().min(1).max(100).transform(s => s.trim()).optional(),
  vendor: z.string().max(50).transform(s => s.trim()).optional(),
  version: z.string().max(50).transform(s => s.trim()).optional(),
  arch: z.string().max(20).transform(s => s.trim()).optional(),
  format: z.enum(['qcow2', 'raw', 'vmdk', 'img']).optional(),
  sourceType: z.enum(['url', 'volume']).optional(),
  downloadUrl: z.string().url().nullable().optional(),
  checksumUrl: z.string().url().nullable().optional(),
  volumeId: z.string().max(200).nullable().optional(),
  defaultDiskSize: z.string().regex(/^\d+G$/).optional(),
  minMemory: z.number().int().min(128).max(1048576).optional(),
  recommendedMemory: z.number().int().min(128).max(1048576).optional(),
  minCores: z.number().int().min(1).max(128).optional(),
  recommendedCores: z.number().int().min(1).max(128).optional(),
  ostype: z.string().max(20).optional(),
  tags: z.string().max(200).nullable().optional(),
})

// ─── Templates / Blueprints ──────────────────────────────────────────────────

/** POST /api/v1/templates/blueprints — create a blueprint */
export const createBlueprintSchema = z.object({
  name: z.string().min(1, 'name is required').max(100).transform(s => s.trim()),
  description: z.string().max(500).nullable().optional(),
  imageSlug: z.string().min(1, 'imageSlug is required'),
  hardware: z.object({
    cores: z.number().int().min(1).max(128).default(2),
    sockets: z.number().int().min(1).max(4).default(1),
    memory: z.number().int().min(128).max(1048576).default(2048),
    diskSize: z.string().regex(/^\d+G$/, 'diskSize must be like "20G"').default('20G'),
    scsihw: z.string().default('virtio-scsi-single'),
    networkModel: z.string().default('virtio'),
    networkBridge: z.string().default('vmbr0'),
    vlanTag: z.number().int().min(1).max(4094).nullable().optional(),
    ostype: z.string().default('l26'),
    agent: z.boolean().default(true),
    cpu: z.string().default('host'),
  }),
  cloudInit: z.object({
    ciuser: z.string().optional(),
    sshKeys: z.string().optional(),
    ipconfig0: z.string().default('ip=dhcp'),
    nameserver: z.string().optional(),
    searchdomain: z.string().optional(),
  }).nullable().optional(),
  tags: z.string().max(200).nullable().optional(),
  isPublic: z.boolean().default(true),
})

/** POST /api/v1/templates/deploy — deploy a VM from image/blueprint */
export const deploySchema = z.object({
  connectionId: z.string().min(1, 'connectionId is required'),
  node: z.string().min(1, 'node is required'),
  storage: z.string().min(1, 'storage is required'),
  vmid: z.number().int().min(100).max(999999999),
  vmName: z.string().max(63).regex(/^[a-zA-Z][a-zA-Z0-9._-]*$/, 'Invalid VM name').optional(),
  imageSlug: z.string().min(1, 'imageSlug is required'),
  blueprintId: z.string().optional(),
  hardware: z.object({
    cores: z.number().int().min(1).max(128).default(2),
    sockets: z.number().int().min(1).max(4).default(1),
    memory: z.number().int().min(128).max(1048576).default(2048),
    diskSize: z.string().regex(/^\d+G$/, 'diskSize must be like "20G"').default('20G'),
    scsihw: z.string().default('virtio-scsi-single'),
    networkModel: z.string().default('virtio'),
    networkBridge: z.string().default('vmbr0'),
    vlanTag: z.number().int().min(1).max(4094).nullable().optional(),
    ostype: z.string().default('l26'),
    agent: z.boolean().default(true),
    cpu: z.string().default('host'),
  }),
  cloudInit: z.object({
    ciuser: z.string().optional(),
    cipassword: z.string().optional(),
    sshKeys: z.string().optional(),
    ipconfig0: z.string().default('ip=dhcp'),
    nameserver: z.string().optional(),
    searchdomain: z.string().optional(),
  }).optional(),
  saveAsBlueprint: z.boolean().default(false),
  blueprintName: z.string().max(100).optional(),
})
