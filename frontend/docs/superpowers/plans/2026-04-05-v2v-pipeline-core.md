# virt-v2v Pipeline Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core virt-v2v orchestration pipeline that executes virt-v2v on a Proxmox node via SSH, parses progress, imports converted disks, and configures the VM from libvirt XML output.

**Architecture:** A new `v2v-pipeline.ts` module follows the same patterns as `pipeline.ts` (ESXi) and `xcpng-pipeline.ts` (XCP-ng): orchestrate via SSH commands on the Proxmox node + PVE API calls. A separate `v2vConfigMapper.ts` parses the libvirt XML output from virt-v2v to produce Proxmox VM creation params. The existing `MigrationJob` Prisma model and status tracking patterns are reused. The migration route (`/api/v1/migrations`) is extended to route `vcenter`, `hyperv`, and `nutanix` source types to the new pipeline.

**Tech Stack:** TypeScript, ssh2 (via existing `executeSSH`), Proxmox VE API, Prisma (MigrationJob), libvirt XML parsing

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/migration/v2v-pipeline.ts` (create) | Orchestrate virt-v2v execution, disk import, VM configuration |
| `src/lib/migration/v2vConfigMapper.ts` (create) | Parse libvirt domain XML to Proxmox VM create params |
| `src/lib/migration/v2v-preflight.ts` (create) | Preflight checks: virt-v2v/pv installed, disk space, SSH |
| `src/lib/migration/v2v-progress.ts` (create) | Parse virt-v2v stderr progress lines + pv output |
| `src/app/api/v1/migrations/route.ts` (modify) | Route new sourceTypes to v2v-pipeline |
| `src/app/api/v1/migrations/preflight/route.ts` (create) | API endpoint for preflight check + package install |

---

### Task 1: v2v Preflight Checks

**Files:**
- Create: `src/lib/migration/v2v-preflight.ts`
- Create: `src/app/api/v1/migrations/preflight/route.ts`

- [ ] **Step 1: Create preflight module**

```typescript
// src/lib/migration/v2v-preflight.ts
import { executeSSH } from "@/lib/ssh/exec"
import { getNodeIp } from "@/lib/ssh/node-ip"
import { getConnectionById } from "@/lib/connections/getConnection"

export interface PreflightResult {
  ssh: boolean
  virtV2vInstalled: boolean
  pvInstalled: boolean
  diskSpaceAvailableBytes: number
  diskSpaceRequired: number
  diskSpaceSufficient: boolean
  errors: string[]
}

/**
 * Run preflight checks on a Proxmox node before a virt-v2v migration.
 * Checks: SSH connectivity, virt-v2v installed, pv installed, disk space.
 */
export async function runV2vPreflight(
  targetConnectionId: string,
  targetNode: string,
  requiredDiskBytes: number
): Promise<PreflightResult> {
  const result: PreflightResult = {
    ssh: false,
    virtV2vInstalled: false,
    pvInstalled: false,
    diskSpaceAvailableBytes: 0,
    diskSpaceRequired: requiredDiskBytes,
    diskSpaceSufficient: false,
    errors: [],
  }

  const conn = await getConnectionById(targetConnectionId)
  const nodeIp = await getNodeIp(conn, targetNode)

  // Check SSH connectivity
  const sshTest = await executeSSH(targetConnectionId, nodeIp, "echo ok")
  if (!sshTest.success || !sshTest.output?.includes("ok")) {
    result.errors.push("SSH connection failed")
    return result
  }
  result.ssh = true

  // Check virt-v2v
  const v2vCheck = await executeSSH(targetConnectionId, nodeIp, "which virt-v2v")
  result.virtV2vInstalled = v2vCheck.success && !!v2vCheck.output?.trim()
  if (!result.virtV2vInstalled) {
    result.errors.push("virt-v2v is not installed on the target node")
  }

  // Check pv
  const pvCheck = await executeSSH(targetConnectionId, nodeIp, "which pv")
  result.pvInstalled = pvCheck.success && !!pvCheck.output?.trim()
  if (!result.pvInstalled) {
    result.errors.push("pv is not installed on the target node")
  }

  // Check disk space on /tmp
  const dfResult = await executeSSH(targetConnectionId, nodeIp, "df -B1 /tmp | tail -1 | awk '{print $4}'")
  if (dfResult.success && dfResult.output?.trim()) {
    result.diskSpaceAvailableBytes = parseInt(dfResult.output.trim(), 10) || 0
    result.diskSpaceSufficient = result.diskSpaceAvailableBytes >= requiredDiskBytes
    if (!result.diskSpaceSufficient) {
      const availGB = (result.diskSpaceAvailableBytes / 1073741824).toFixed(1)
      const reqGB = (requiredDiskBytes / 1073741824).toFixed(1)
      result.errors.push(`Insufficient temp disk space: ${availGB} GB available, ${reqGB} GB required`)
    }
  }

  return result
}

/**
 * Install virt-v2v and pv on a Proxmox node via SSH.
 */
export async function installV2vPackages(
  targetConnectionId: string,
  targetNode: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  const conn = await getConnectionById(targetConnectionId)
  const nodeIp = await getNodeIp(conn, targetNode)

  const result = await executeSSH(
    targetConnectionId,
    nodeIp,
    "apt-get update -qq && apt-get install -y virt-v2v pv"
  )

  return result
}
```

- [ ] **Step 2: Create preflight API route**

```typescript
// src/app/api/v1/migrations/preflight/route.ts
import { NextResponse } from "next/server"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { runV2vPreflight, installV2vPackages } from "@/lib/migration/v2v-preflight"

export const runtime = "nodejs"

/**
 * POST /api/v1/migrations/preflight
 * Run preflight checks for virt-v2v migration on target node.
 * Body: { targetConnectionId, targetNode, requiredDiskBytes }
 */
export async function POST(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
    if (denied) return denied

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    const { targetConnectionId, targetNode, requiredDiskBytes = 0, action } = body

    if (!targetConnectionId || !targetNode) {
      return NextResponse.json({ error: "Missing targetConnectionId or targetNode" }, { status: 400 })
    }

    // Install packages action
    if (action === "install") {
      const result = await installV2vPackages(targetConnectionId, targetNode)
      return NextResponse.json({ data: result })
    }

    // Default: run preflight checks
    const result = await runV2vPreflight(targetConnectionId, targetNode, requiredDiskBytes)
    return NextResponse.json({ data: result })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/migration/v2v-preflight.ts src/app/api/v1/migrations/preflight/route.ts
git commit -m "feat(migration): add virt-v2v preflight checks and package install endpoint"
```

---

### Task 2: v2v Progress Parser

**Files:**
- Create: `src/lib/migration/v2v-progress.ts`

- [ ] **Step 1: Create progress parser module**

virt-v2v with `--machine-readable` outputs lines like:
```
[   3.0%] Copying disk 1/2
[  45.5%] Copying disk 1/2
[ 100.0%] Copying disk 1/2
[   0.0%] Copying disk 2/2
```

`pv` outputs lines like:
```
1.23GiB 0:01:30 [ 120MiB/s] [========>               ] 45% ETA 0:01:50
```

```typescript
// src/lib/migration/v2v-progress.ts

export interface V2vProgress {
  percent: number       // 0-100
  currentDisk: number   // 1-based
  totalDisks: number
  step: string          // "Copying disk 1/2", "Converting guest", etc.
}

export interface PvProgress {
  percent: number       // 0-100
  transferred: string   // "1.23GiB"
  speed: string         // "120MiB/s"
  eta: string           // "0:01:50"
}

/**
 * Parse a virt-v2v stderr line into a progress object.
 * Returns null if the line is not a progress line.
 */
export function parseV2vLine(line: string): V2vProgress | null {
  // Match: [  45.5%] Copying disk 1/2
  const progressMatch = line.match(/\[\s*([\d.]+)%\]\s*(.+)/)
  if (!progressMatch) return null

  const percent = parseFloat(progressMatch[1])
  const step = progressMatch[2].trim()

  // Extract disk info: "Copying disk 1/2"
  const diskMatch = step.match(/disk\s+(\d+)\/(\d+)/)
  const currentDisk = diskMatch ? parseInt(diskMatch[1], 10) : 1
  const totalDisks = diskMatch ? parseInt(diskMatch[2], 10) : 1

  return { percent, currentDisk, totalDisks, step }
}

/**
 * Calculate overall progress across multiple disks.
 * Each disk gets an equal weight of the total progress.
 */
export function calculateOverallProgress(v2v: V2vProgress): number {
  if (v2v.totalDisks <= 1) return Math.round(v2v.percent)
  const perDiskWeight = 100 / v2v.totalDisks
  const completedDisks = (v2v.currentDisk - 1) * perDiskWeight
  const currentDiskProgress = (v2v.percent / 100) * perDiskWeight
  return Math.min(100, Math.round(completedDisks + currentDiskProgress))
}

/**
 * Parse a pv stderr line into a progress object.
 * Returns null if the line is not a pv progress line.
 */
export function parsePvLine(line: string): PvProgress | null {
  // Match: 1.23GiB 0:01:30 [ 120MiB/s] [========>               ] 45% ETA 0:01:50
  const pvMatch = line.match(/([\d.]+\w+)\s+[\d:]+\s+\[\s*([\d.]+\w+\/s)\].*?(\d+)%(?:\s+ETA\s+([\d:]+))?/)
  if (!pvMatch) return null

  return {
    transferred: pvMatch[1],
    speed: pvMatch[2],
    percent: parseInt(pvMatch[3], 10),
    eta: pvMatch[4] || "",
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/migration/v2v-progress.ts
git commit -m "feat(migration): add virt-v2v and pv progress parsers"
```

---

### Task 3: v2v Config Mapper (libvirt XML to Proxmox)

**Files:**
- Create: `src/lib/migration/v2vConfigMapper.ts`

- [ ] **Step 1: Create XML config mapper**

virt-v2v produces a libvirt domain XML file. We parse it to extract VM configuration for Proxmox.

```typescript
// src/lib/migration/v2vConfigMapper.ts

export interface V2vVmConfig {
  name: string
  memory: number       // MB
  cores: number
  sockets: number
  firmware: "bios" | "efi"
  ostype: string       // l26, win10, win11, etc.
  machine: string      // q35
  scsihw: string       // virtio-scsi-single
  nics: { model: string; mac?: string }[]
  disks: { file: string; format: string; device: string }[] // sda, sdb...
}

/**
 * Parse a libvirt domain XML string produced by virt-v2v.
 * Extracts VM configuration needed to create a Proxmox VM.
 */
export function parseV2vXml(xmlString: string): V2vVmConfig {
  // Simple tag-based parsing (no external XML lib needed for this structure)
  const getTag = (xml: string, tag: string): string => {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`))
    return match ? match[1].trim() : ""
  }

  const getAttr = (xml: string, tag: string, attr: string): string => {
    const tagMatch = xml.match(new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["'][^>]*>`))
    return tagMatch ? tagMatch[1] : ""
  }

  // Name
  const name = getTag(xmlString, "name") || "vm"

  // Memory (libvirt uses KiB by default)
  const memoryStr = getTag(xmlString, "memory")
  const memoryUnit = getAttr(xmlString, "memory", "unit") || "KiB"
  let memoryMB = parseInt(memoryStr, 10) || 1024
  if (memoryUnit === "KiB") memoryMB = Math.round(memoryMB / 1024)
  else if (memoryUnit === "GiB") memoryMB = memoryMB * 1024
  else if (memoryUnit === "bytes") memoryMB = Math.round(memoryMB / 1048576)

  // vCPU
  const vcpuStr = getTag(xmlString, "vcpu")
  const cores = parseInt(vcpuStr, 10) || 1

  // Firmware: check for UEFI loader
  const hasUefiLoader = xmlString.includes('type="pflash"') || xmlString.includes("/OVMF_CODE")
  const firmware = hasUefiLoader ? "efi" : "bios"

  // OS type detection from metadata or name
  const ostype = detectOsType(xmlString, name)

  // NICs
  const nics: { model: string; mac?: string }[] = []
  const interfaceBlocks = xmlString.match(/<interface[^>]*>[\s\S]*?<\/interface>/g) || []
  for (const block of interfaceBlocks) {
    const model = getAttr(block, "model", "type") || "virtio"
    const mac = getAttr(block, "mac", "address") || undefined
    nics.push({ model, mac })
  }

  // Disks
  const disks: { file: string; format: string; device: string }[] = []
  const diskBlocks = xmlString.match(/<disk[^>]*type=["']file["'][^>]*>[\s\S]*?<\/disk>/g) || []
  for (const block of diskBlocks) {
    const file = getAttr(block, "source", "file") || ""
    const format = getAttr(block, "driver", "type") || "raw"
    const device = getAttr(block, "target", "dev") || `sd${String.fromCharCode(97 + disks.length)}`
    if (file) disks.push({ file, format, device })
  }

  return {
    name: sanitizeName(name),
    memory: memoryMB,
    cores,
    sockets: 1,
    firmware,
    ostype,
    machine: "q35",
    scsihw: "virtio-scsi-single",
    nics: nics.length > 0 ? nics : [{ model: "virtio" }],
    disks,
  }
}

/** Detect Proxmox ostype from libvirt XML metadata and VM name */
function detectOsType(xml: string, name: string): string {
  const lower = xml.toLowerCase() + " " + name.toLowerCase()
  if (lower.includes("win11") || lower.includes("windows 11")) return "win11"
  if (lower.includes("win10") || lower.includes("windows 10")) return "win10"
  if (lower.includes("win8") || lower.includes("windows 8")) return "win8"
  if (lower.includes("win7") || lower.includes("windows 7")) return "win7"
  if (lower.includes("windows server 2022") || lower.includes("windows server 2025")) return "win11"
  if (lower.includes("windows server 2019") || lower.includes("windows server 2016")) return "win10"
  if (lower.includes("windows")) return "win10"
  if (lower.includes("freebsd")) return "other"
  return "l26"
}

/** Sanitize VM name for Proxmox DNS validation */
function sanitizeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9.-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 63) || "vm"
}

/**
 * Build Proxmox VM creation parameters from parsed v2v config.
 */
export function buildPveCreateParams(config: V2vVmConfig, vmid: number, networkBridge: string): Record<string, any> {
  const params: Record<string, any> = {
    vmid,
    name: config.name,
    ostype: config.ostype,
    cores: config.cores,
    sockets: config.sockets,
    memory: config.memory,
    cpu: "x86-64-v2-AES",
    scsihw: config.scsihw,
    bios: config.firmware === "efi" ? "ovmf" : "seabios",
    machine: config.machine,
    boot: "order=scsi0",
    agent: "enabled=0",
  }

  // Network: first NIC
  const nic = config.nics[0]
  params.net0 = `${nic.model},bridge=${networkBridge}${nic.mac ? `,macaddr=${nic.mac}` : ""}`

  // Additional NICs
  for (let i = 1; i < config.nics.length; i++) {
    const n = config.nics[i]
    params[`net${i}`] = `${n.model},bridge=${networkBridge}${n.mac ? `,macaddr=${n.mac}` : ""}`
  }

  return params
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/migration/v2vConfigMapper.ts
git commit -m "feat(migration): add virt-v2v libvirt XML config mapper for Proxmox"
```

---

### Task 4: v2v Pipeline Core

**Files:**
- Create: `src/lib/migration/v2v-pipeline.ts`

- [ ] **Step 1: Create the v2v pipeline**

This is the main orchestration module. It follows the same patterns as `pipeline.ts`:
- `updateJob()` / `appendLog()` / `isCancelled()` for status tracking
- `executeSSH()` for commands on the Proxmox node
- `pveFetch()` for PVE API calls
- Runs async via Next.js `after()` callback

```typescript
// src/lib/migration/v2v-pipeline.ts

import { getTenantPrisma } from "@/lib/tenant"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { isFileBasedStorage } from "@/lib/proxmox/storage"
import { executeSSH } from "@/lib/ssh/exec"
import { getNodeIp } from "@/lib/ssh/node-ip"
import { shellEscape } from "@/lib/ssh/exec"
import { parseV2vLine, calculateOverallProgress, parsePvLine } from "./v2v-progress"
import { parseV2vXml, buildPveCreateParams } from "./v2vConfigMapper"

type MigrationStatus = "pending" | "preflight" | "creating_vm" | "transferring" | "configuring" | "completed" | "failed" | "cancelled"

interface V2vMigrationConfig {
  sourceConnectionId: string
  sourceVmId: string
  sourceVmName: string
  sourceType: "vcenter" | "hyperv" | "nutanix"
  targetConnectionId: string
  targetNode: string
  targetStorage: string
  networkBridge: string
  startAfterMigration: boolean
  // vCenter-specific
  vcenterDatacenter?: string
  vcenterHost?: string
  // Hyper-V disk-based fallback
  diskPaths?: string[]
}

interface LogEntry {
  ts: string
  msg: string
  level: "info" | "success" | "warn" | "error"
}

let cancelledJobs = new Set<string>()

export function cancelV2vMigrationJob(jobId: string) {
  cancelledJobs.add(jobId)
}

const jobPrisma = new Map<string, any>()

function getPrismaForJob(jobId: string) {
  return jobPrisma.get(jobId)
}

async function updateJob(id: string, status: MigrationStatus, extra: Record<string, any> = {}) {
  const prisma = getPrismaForJob(id)
  const data: any = {
    status,
    currentStep: status,
    ...(status === "completed" ? { completedAt: new Date() } : {}),
    ...extra,
  }
  await prisma.migrationJob.update({ where: { id }, data })
}

async function appendLog(id: string, msg: string, level: LogEntry["level"] = "info") {
  const prisma = getPrismaForJob(id)
  const job = await prisma.migrationJob.findUnique({ where: { id }, select: { logs: true, progress: true } })
  const logs: LogEntry[] = job?.logs ? JSON.parse(job.logs) : []
  logs.push({ ts: new Date().toISOString(), msg, level })
  await prisma.migrationJob.update({ where: { id }, data: { logs: JSON.stringify(logs) } })
}

function isCancelled(jobId: string): boolean {
  return cancelledJobs.has(jobId)
}

/**
 * Build the virt-v2v command based on source type.
 */
function buildV2vCommand(config: V2vMigrationConfig, jobId: string): string {
  const outputDir = `/tmp/v2v-${jobId}`
  const pwFile = `/tmp/v2v-pwfile-${jobId}`

  if (config.sourceType === "vcenter") {
    // vpx://user@vcenter/Datacenter/host/esxi-host?no_verify=1
    const dcPath = config.vcenterDatacenter || "ha-datacenter"
    const hostPart = config.vcenterHost ? `/host/${config.vcenterHost}` : ""
    return [
      `mkdir -p ${shellEscape(outputDir)}`,
      `&&`,
      `virt-v2v`,
      `-ic`, shellEscape(`vpx://\${V2V_USER}@\${V2V_HOST}/${dcPath}${hostPart}?no_verify=1`),
      `-ip`, shellEscape(pwFile),
      shellEscape(config.sourceVmName),
      `-o local`,
      `-os`, shellEscape(outputDir),
      `--machine-readable`,
      `2>&1`,
    ].join(" ")
  }

  if (config.sourceType === "hyperv") {
    if (config.diskPaths && config.diskPaths.length > 0) {
      // Disk-based mode (user exported VHDX)
      return [
        `mkdir -p ${shellEscape(outputDir)}`,
        `&&`,
        `virt-v2v`,
        `-i disk`,
        ...config.diskPaths.map(p => shellEscape(p)),
        `-o local`,
        `-os`, shellEscape(outputDir),
        `--machine-readable`,
        `2>&1`,
      ].join(" ")
    }
    // Direct Hyper-V connection
    return [
      `mkdir -p ${shellEscape(outputDir)}`,
      `&&`,
      `virt-v2v`,
      `-ic`, shellEscape(`hyperv://\${V2V_USER}@\${V2V_HOST}`),
      `-ip`, shellEscape(pwFile),
      shellEscape(config.sourceVmName),
      `-o local`,
      `-os`, shellEscape(outputDir),
      `--machine-readable`,
      `2>&1`,
    ].join(" ")
  }

  if (config.sourceType === "nutanix") {
    // Nutanix: disks already downloaded by caller, use -i disk
    const diskPaths = config.diskPaths || []
    return [
      `mkdir -p ${shellEscape(outputDir)}`,
      `&&`,
      `virt-v2v`,
      `-i disk`,
      ...diskPaths.map(p => shellEscape(p)),
      `-o local`,
      `-os`, shellEscape(outputDir),
      `--machine-readable`,
      `2>&1`,
    ].join(" ")
  }

  throw new Error(`Unsupported source type: ${config.sourceType}`)
}

/**
 * Main virt-v2v migration pipeline.
 */
export async function runV2vMigrationPipeline(
  jobId: string,
  config: V2vMigrationConfig,
  tenantId: string
): Promise<void> {
  const prisma = await getTenantPrisma(tenantId)
  jobPrisma.set(jobId, prisma)

  try {
    // ── Phase 1: Preflight ──
    await updateJob(jobId, "preflight")
    await appendLog(jobId, `Starting virt-v2v migration (${config.sourceType}): ${config.sourceVmName}`)

    const pveConn = await getConnectionById(config.targetConnectionId)
    const nodeIp = await getNodeIp(pveConn, config.targetNode)
    const outputDir = `/tmp/v2v-${jobId}`
    const pwFile = `/tmp/v2v-pwfile-${jobId}`

    // Verify virt-v2v is installed
    const v2vCheck = await executeSSH(config.targetConnectionId, nodeIp, "which virt-v2v")
    if (!v2vCheck.success || !v2vCheck.output?.trim()) {
      throw new Error("virt-v2v is not installed on the target Proxmox node. Install with: apt-get install virt-v2v pv")
    }

    if (isCancelled(jobId)) { await updateJob(jobId, "cancelled"); return }

    // Write password file for vCenter/Hyper-V
    if (config.sourceType !== "nutanix") {
      const sourceConn = await prisma.connection.findUnique({
        where: { id: config.sourceConnectionId },
        select: { apiTokenEnc: true, baseUrl: true },
      })
      if (!sourceConn?.apiTokenEnc) throw new Error("Source connection credentials not found")

      const { decryptSecret } = await import("@/lib/crypto/secret")
      const decrypted = decryptSecret(sourceConn.apiTokenEnc)
      const [user, ...passParts] = decrypted.split(":")
      const password = passParts.join(":")

      // Parse host from baseUrl
      const host = (sourceConn.baseUrl || "").replace(/^https?:\/\//, "").replace(/:\d+$/, "").replace(/\/.*$/, "")

      // Create password file on node
      await executeSSH(config.targetConnectionId, nodeIp,
        `printf '%s' ${shellEscape(password)} > ${shellEscape(pwFile)} && chmod 600 ${shellEscape(pwFile)}`)

      // Set env vars for command substitution
      await appendLog(jobId, `Source: ${config.sourceType} @ ${host} (user: ${user})`)
    }

    // ── Phase 2: Create VM shell on Proxmox ──
    await updateJob(jobId, "creating_vm")
    await appendLog(jobId, "Allocating VMID on Proxmox...")

    const nextIdRes = await pveFetch<string>(pveConn, "/cluster/nextid")
    const vmid = parseInt(String(nextIdRes), 10)
    if (!vmid || isNaN(vmid)) throw new Error("Failed to allocate VMID")

    await prisma.migrationJob.update({ where: { id: jobId }, data: { targetVmid: vmid } })
    await appendLog(jobId, `Allocated VMID: ${vmid}`)

    if (isCancelled(jobId)) { await updateJob(jobId, "cancelled"); return }

    // ── Phase 3: Execute virt-v2v ──
    await updateJob(jobId, "transferring", { progress: 0 })
    await appendLog(jobId, "Running virt-v2v conversion...")

    // Build and execute virt-v2v command
    // For vCenter/Hyper-V, inject user/host as env vars
    let v2vCmd = buildV2vCommand(config, jobId)

    if (config.sourceType === "vcenter" || config.sourceType === "hyperv") {
      const sourceConn = await prisma.connection.findUnique({
        where: { id: config.sourceConnectionId },
        select: { apiTokenEnc: true, baseUrl: true },
      })
      const { decryptSecret } = await import("@/lib/crypto/secret")
      const decrypted = decryptSecret(sourceConn!.apiTokenEnc)
      const [user] = decrypted.split(":")
      const host = (sourceConn!.baseUrl || "").replace(/^https?:\/\//, "").replace(/:\d+$/, "").replace(/\/.*$/, "")

      // Replace placeholders with actual values
      v2vCmd = v2vCmd.replace(/\$\{V2V_USER\}/g, user).replace(/\$\{V2V_HOST\}/g, host)
    }

    const v2vResult = await executeSSH(config.targetConnectionId, nodeIp, v2vCmd)

    // Parse progress from output (in production, we'd stream this - for now process the full output)
    if (v2vResult.output) {
      const lines = v2vResult.output.split("\n")
      for (const line of lines) {
        const progress = parseV2vLine(line)
        if (progress) {
          const overall = calculateOverallProgress(progress)
          await prisma.migrationJob.update({
            where: { id: jobId },
            data: {
              progress: overall,
              currentStep: progress.step,
              currentDisk: progress.currentDisk,
              totalDisks: progress.totalDisks,
            },
          })
        }
      }
    }

    if (!v2vResult.success) {
      throw new Error(`virt-v2v failed: ${v2vResult.error || v2vResult.output || "Unknown error"}`)
    }

    await appendLog(jobId, "virt-v2v conversion completed", "success")

    // Clean up password file
    await executeSSH(config.targetConnectionId, nodeIp, `rm -f ${shellEscape(pwFile)}`).catch(() => {})

    if (isCancelled(jobId)) { await updateJob(jobId, "cancelled"); return }

    // ── Phase 4: Parse XML and create VM ──
    await updateJob(jobId, "configuring")
    await appendLog(jobId, "Parsing virt-v2v output and configuring VM...")

    // Read the libvirt XML
    const xmlResult = await executeSSH(config.targetConnectionId, nodeIp,
      `cat ${shellEscape(outputDir)}/*.xml 2>/dev/null || echo ""`)
    
    let vmConfig
    if (xmlResult.success && xmlResult.output?.includes("<domain")) {
      vmConfig = parseV2vXml(xmlResult.output)
    } else {
      // Fallback: minimal config from source info
      vmConfig = {
        name: config.sourceVmName.replace(/[^a-zA-Z0-9.-]/g, "-").substring(0, 63) || "vm",
        memory: 2048,
        cores: 2,
        sockets: 1,
        firmware: "bios" as const,
        ostype: "l26",
        machine: "q35",
        scsihw: "virtio-scsi-single",
        nics: [{ model: "virtio" }],
        disks: [],
      }
      await appendLog(jobId, "No libvirt XML found, using fallback configuration", "warn")
    }

    // Create VM on Proxmox
    const createParams = buildPveCreateParams(vmConfig, vmid, config.networkBridge)
    await pveFetch(pveConn, `/nodes/${encodeURIComponent(config.targetNode)}/qemu`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(Object.entries(createParams).map(([k, v]) => [k, String(v)])).toString(),
    })
    await appendLog(jobId, `VM ${vmid} created: ${vmConfig.name} (${vmConfig.cores} cores, ${vmConfig.memory} MB)`)

    // ── Phase 5: Import disks ──
    // List output disk files
    const lsResult = await executeSSH(config.targetConnectionId, nodeIp,
      `ls -1 ${shellEscape(outputDir)}/ | grep -v '\\.xml$' | sort`)

    const diskFiles = (lsResult.output || "").split("\n").map(f => f.trim()).filter(f => f && !f.endsWith(".xml"))

    if (diskFiles.length === 0) {
      throw new Error("virt-v2v produced no disk files")
    }

    await appendLog(jobId, `Importing ${diskFiles.length} disk(s) into Proxmox storage ${config.targetStorage}...`)

    // Get storage type to determine import method
    const storages = await pveFetch<any[]>(pveConn, `/nodes/${encodeURIComponent(config.targetNode)}/storage`)
    const targetStorageInfo = (Array.isArray(storages) ? storages : []).find((s: any) => s.storage === config.targetStorage)
    const isFileBased = targetStorageInfo ? isFileBasedStorage(targetStorageInfo.type) : true

    for (let i = 0; i < diskFiles.length; i++) {
      const diskFile = diskFiles[i]
      const diskPath = `${outputDir}/${diskFile}`
      const diskIndex = i

      await appendLog(jobId, `Importing disk ${i + 1}/${diskFiles.length}: ${diskFile}`)

      if (isFileBased) {
        // File-based: qm disk import
        const importResult = await executeSSH(config.targetConnectionId, nodeIp,
          `qm disk import ${vmid} ${shellEscape(diskPath)} ${shellEscape(config.targetStorage)} --format qcow2`)
        if (!importResult.success) {
          throw new Error(`Disk import failed: ${importResult.error || importResult.output}`)
        }
      } else {
        // Block storage: pvesm alloc + pv | dd
        const sizeResult = await executeSSH(config.targetConnectionId, nodeIp,
          `stat -c %s ${shellEscape(diskPath)}`)
        const sizeBytes = parseInt(sizeResult.output?.trim() || "0", 10)
        const sizeKB = Math.ceil(sizeBytes / 1024)

        const volName = `vm-${vmid}-disk-${diskIndex}`
        const allocResult = await executeSSH(config.targetConnectionId, nodeIp,
          `pvesm alloc ${shellEscape(config.targetStorage)} ${vmid} ${shellEscape(volName)} ${sizeKB}K`)
        if (!allocResult.success) {
          throw new Error(`Storage alloc failed: ${allocResult.error || allocResult.output}`)
        }

        const volId = `${config.targetStorage}:${vmid}/${volName}`
        const pathResult = await executeSSH(config.targetConnectionId, nodeIp,
          `pvesm path ${shellEscape(volId)}`)
        const devicePath = pathResult.output?.trim()
        if (!devicePath || !devicePath.startsWith("/")) {
          throw new Error(`Invalid device path from pvesm: ${devicePath}`)
        }

        const ddResult = await executeSSH(config.targetConnectionId, nodeIp,
          `pv ${shellEscape(diskPath)} | dd of=${shellEscape(devicePath)} bs=4M oflag=direct 2>&1`)
        if (!ddResult.success) {
          throw new Error(`Disk write failed: ${ddResult.error || ddResult.output}`)
        }
      }

      // Attach disk to VM
      const diskConfig = vmConfig.firmware === "efi" && diskIndex === 0
        ? `${config.targetStorage}:${vmid}/vm-${vmid}-disk-${diskIndex},size=${0}` // size auto-detected
        : undefined

      await pveFetch(pveConn, `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${vmid}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ [`scsi${diskIndex}`]: `${config.targetStorage}:${vmid}/vm-${vmid}-disk-${diskIndex}` }).toString(),
      })

      await appendLog(jobId, `Disk ${i + 1}/${diskFiles.length} imported and attached as scsi${diskIndex}`, "success")
    }

    // Set boot order
    await pveFetch(pveConn, `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${vmid}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ boot: "order=scsi0" }).toString(),
    })

    // EFI disk if needed
    if (vmConfig.firmware === "efi") {
      await pveFetch(pveConn, `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${vmid}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ efidisk0: `${config.targetStorage}:1,format=qcow2,efitype=4m,pre-enrolled-keys=1` }).toString(),
      })
      await appendLog(jobId, "EFI disk created")
    }

    // ── Phase 6: Cleanup and finish ──
    await executeSSH(config.targetConnectionId, nodeIp, `rm -rf ${shellEscape(outputDir)}`).catch(() => {})
    await appendLog(jobId, "Temporary files cleaned up")

    // Optionally start VM
    if (config.startAfterMigration) {
      await pveFetch(pveConn, `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${vmid}/status/start`, {
        method: "POST",
      })
      await appendLog(jobId, `VM ${vmid} started`, "success")
    }

    await updateJob(jobId, "completed", { progress: 100 })
    await appendLog(jobId, `Migration completed successfully. VMID: ${vmid}`, "success")

  } catch (error: any) {
    const msg = error?.message || String(error)
    await appendLog(jobId, `Migration failed: ${msg}`, "error")
    await updateJob(jobId, "failed", { error: msg })

    // Cleanup on failure
    try {
      const pveConn = await getConnectionById(config.targetConnectionId)
      const nodeIp = await getNodeIp(pveConn, config.targetNode)
      await executeSSH(config.targetConnectionId, nodeIp, `rm -rf /tmp/v2v-${jobId} /tmp/v2v-pwfile-${jobId}`).catch(() => {})
    } catch {}
  } finally {
    jobPrisma.delete(jobId)
    cancelledJobs.delete(jobId)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/migration/v2v-pipeline.ts
git commit -m "feat(migration): add virt-v2v orchestration pipeline"
```

---

### Task 5: Wire v2v Pipeline into Migrations API Route

**Files:**
- Modify: `src/app/api/v1/migrations/route.ts`

- [ ] **Step 1: Update the POST handler to route new source types**

In `src/app/api/v1/migrations/route.ts`, add the import and routing logic:

At the top, add import:
```typescript
import { runV2vMigrationPipeline } from "@/lib/migration/v2v-pipeline"
```

In the POST handler, change the source type validation from:
```typescript
if (!sourceConn || (sourceConn.type !== "vmware" && sourceConn.type !== "xcpng")) {
  return NextResponse.json({ error: "Source hypervisor connection not found (must be vmware or xcpng)" }, { status: 404 })
}
```
To:
```typescript
const validSourceTypes = ["vmware", "xcpng", "vcenter", "hyperv", "nutanix"]
if (!sourceConn || !validSourceTypes.includes(sourceConn.type)) {
  return NextResponse.json({ error: "Source hypervisor connection not found" }, { status: 404 })
}
```

Change the `sourceType` assignment from:
```typescript
const sourceType = sourceConn.type as "vmware" | "xcpng"
```
To:
```typescript
const sourceType = sourceConn.type as "vmware" | "xcpng" | "vcenter" | "hyperv" | "nutanix"
```

Also handle VMware with `subType === "vcenter"`:
```typescript
// Determine effective source type (vmware with subType=vcenter routes to v2v pipeline)
let effectiveSourceType = sourceType
if (sourceType === "vmware" && sourceConn.subType === "vcenter") {
  effectiveSourceType = "vcenter"
}
```

Update the `after()` block from:
```typescript
after(async () => {
  if (sourceType === "xcpng") {
    await runXcpngMigrationPipeline(job.id, { ...migrationConfig, migrationType: (migrationType === "sshfs_boot" ? "cold" : migrationType) as "cold" | "live" }, tenantId)
  } else {
    await runMigrationPipeline(job.id, migrationConfig, tenantId)
  }
})
```
To:
```typescript
after(async () => {
  if (effectiveSourceType === "vcenter" || effectiveSourceType === "hyperv" || effectiveSourceType === "nutanix") {
    const { sourceVmName = "", vcenterDatacenter, vcenterHost, diskPaths } = body
    await runV2vMigrationPipeline(job.id, {
      ...migrationConfig,
      sourceVmName,
      sourceType: effectiveSourceType as "vcenter" | "hyperv" | "nutanix",
      vcenterDatacenter,
      vcenterHost,
      diskPaths,
    }, tenantId)
  } else if (effectiveSourceType === "xcpng") {
    await runXcpngMigrationPipeline(job.id, { ...migrationConfig, migrationType: (migrationType === "sshfs_boot" ? "cold" : migrationType) as "cold" | "live" }, tenantId)
  } else {
    await runMigrationPipeline(job.id, migrationConfig, tenantId)
  }
})
```

Also add `subType` to the sourceConn select:
```typescript
const [sourceConn, pveConn] = await Promise.all([
  prisma.connection.findUnique({ where: { id: sourceConnectionId }, select: { id: true, type: true, subType: true, name: true, baseUrl: true } }),
  prisma.connection.findUnique({ where: { id: targetConnectionId }, select: { id: true, type: true, name: true } }),
])
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors (or only pre-existing ones unrelated to migration)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/migrations/route.ts
git commit -m "feat(migration): route vcenter/hyperv/nutanix source types to v2v pipeline"
```

---

### Task 6: Database Schema Update

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add subType field to Connection model**

Find the `Connection` model in `prisma/schema.prisma` and add the `subType` field. Since ProxCenter uses a hybrid approach (sqlite.ts manages the Connection table, not Prisma migrations), we add it via raw SQL instead.

Add the column via `sqlite.ts` initialization. Find where Connection columns are created and add:

```sql
ALTER TABLE connections ADD COLUMN sub_type TEXT;
```

This should be added as a safe migration (wrapped in try/catch to handle column already existing).

Search for where Connection table modifications happen in `src/lib/db/sqlite.ts` and add the ALTER TABLE there.

- [ ] **Step 2: Also update the Prisma schema for type generation**

In `prisma/schema.prisma`, find the Connection-related comments or model references and note that `subType` needs to be accessible. Since Connection is managed by `sqlite.ts` (not Prisma), add it to the raw query patterns used in `ConnectionDialog` and `getConnection`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/sqlite.ts
git commit -m "feat(db): add sub_type column to connections table for vmware vcenter distinction"
```

---

## Self-Review Notes

- All file paths are exact and exist in the codebase or will be created
- Types (`V2vMigrationConfig`, `V2vVmConfig`, `PreflightResult`, `V2vProgress`, `PvProgress`) are consistent across tasks
- `parseV2vLine()` in Task 2 is used by Task 4 pipeline
- `parseV2vXml()` and `buildPveCreateParams()` in Task 3 are used by Task 4 pipeline
- `runV2vPreflight()` in Task 1 is used by the preflight API route (same task) and will be called from UI (Plan 2)
- `runV2vMigrationPipeline()` in Task 4 is imported by Task 5 (migrations route)
- The `shellEscape()` function is already exported from `src/lib/ssh/exec.ts`
- `MigrationJob` Prisma model is reused as-is (no schema changes needed for the job table)
- The Connection `subType` field (Task 6) is referenced in Task 5 routing logic
