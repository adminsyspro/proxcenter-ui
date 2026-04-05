# virt-v2v Integration - Multi-Hypervisor Migration Engine

**Date:** 2026-04-05
**Status:** Draft
**Scope:** Add vCenter, Hyper-V, and Nutanix AHV migration support via virt-v2v

## Context

ProxCenter supports ESXi (direct SOAP) and XCP-ng (XO REST API) migrations today. Post-Broadcom VMware acquisition, there is massive demand for vCenter-managed VMware migrations. Our current ESXi pipeline requires direct SSH access to individual ESXi hosts and does not support vCenter or vSAN.

virt-v2v (Red Hat, GPLv2, maintained since 2007) converts VMs from foreign hypervisors to KVM. It handles vCenter API, disk conversion, virtio driver injection, and guest OS modifications. It runs as a CLI tool on the Proxmox node.

## Goals

1. Support VMware vCenter migrations (the primary market gap)
2. Support Hyper-V migrations
3. Support Nutanix AHV migrations
4. Keep existing ESXi direct and XCP-ng pipelines untouched
5. Cold migration only for v1 (VM source must be powered off or snapshotted)
6. Reuse existing MigrationJob model, wizard UI structure, and progress tracking patterns

## Non-Goals

- Live migration via virt-v2v (v2 consideration)
- Near-zero downtime mode for vCenter (v2 consideration)
- Replacing existing ESXi direct or XCP-ng pipelines
- VDDK support (v2 consideration for vSAN - requires proprietary Broadcom library)
- Nutanix Move integration

---

## Architecture

### Migration Engine Matrix

| Source | Engine | VM Listing | Disk Access | Driver Injection |
|---|---|---|---|---|
| ESXi standalone | Existing pipeline (SOAP + SSH) | SOAP PropertyCollector | HTTPS/SSHFS/SSH dd | None (manual) |
| vCenter | **virt-v2v** | SOAP via vCenter | virt-v2v HTTPS transport | **Automatic (virtio)** |
| Hyper-V | **virt-v2v** | virt-v2v / manual VHDX | virt-v2v libvirt or `-i disk` | **Automatic (virtio)** |
| Nutanix AHV | **Prism API + virt-v2v** | Prism REST API | Prism API download + virt-v2v `-i disk` | **Automatic (virtio)** |
| XCP-ng | Existing pipeline (XO REST) | XO REST API | XO REST VDI download | None (manual) |

### Data Flow (virt-v2v migrations)

```
ProxCenter (orchestrator)
  |
  |-- 1. Preflight check via SSH on target Proxmox node
  |     - Check: virt-v2v installed? pv installed? disk space?
  |     - Offer one-click install if missing
  |
  |-- 2. List VMs from source (varies by type)
  |     - vCenter: SOAP API via vCenter URL
  |     - Hyper-V: virt-v2v capabilities or manual
  |     - Nutanix: Prism v3 REST API
  |
  |-- 3. Create empty VM shell on Proxmox (PVE API)
  |
  |-- 4. SSH to Proxmox node, execute virt-v2v
  |     - Writes converted disks + libvirt XML to /tmp/v2v-<jobid>/
  |     - Progress: parse stderr in real-time
  |
  |-- 5. Import disks into Proxmox storage
  |     - Block storage: pv <disk> | dd of=<device> bs=4M
  |     - File storage: qm disk import <vmid> <file> <storage>
  |     - Progress: pv output
  |
  |-- 6. Configure VM from virt-v2v XML output (PVE API)
  |     - CPU, RAM, UEFI/BIOS, NICs, boot order
  |
  |-- 7. Cleanup temp files
```

### Nutanix-specific Flow

Nutanix VMs cannot be accessed by virt-v2v directly. The flow adds a disk download phase:

```
ProxCenter
  |-- 1. Prism API: list VMs, get disk info
  |-- 2. Prism API: create snapshot, download disk images (qcow2) to Proxmox node
  |-- 3. virt-v2v -i disk <downloaded-disk> -o local -os /tmp/v2v-<jobid>/
  |-- 4. Import + configure (same as above)
```

### Hyper-V Flow

virt-v2v supports Hyper-V via libvirt connection. If direct connection fails, fallback to manual disk export:

```
Attempt 1: virt-v2v -ic hyperv://... (if supported by installed libvirt)
Attempt 2: User exports VHDX to NFS share, virt-v2v -i disk <path>
```

---

## Connection Types

### Updated ConnectionDialog

**VMware (existing type, extended):**
- Sub-type selector: "ESXi (Direct)" | "vCenter"
- Common fields: Name, URL, User, Password, Insecure TLS
- vCenter additional fields: Datacenter path (e.g., `/Datacenter1`)
- ESXi keeps existing SSH configuration fields
- Stored as type `vmware` with new field `subType: 'esxi' | 'vcenter'`

**Hyper-V (new type):**
- Fields: Name, Host/URL, User, Password
- Stored as type `hyperv`

**Nutanix (new type):**
- Fields: Name, Prism Central URL, User, Password, Insecure TLS
- Stored as type `nutanix`

### Database Changes

`Connection` model adds:
- `subType` field (nullable string) - for VMware ESXi vs vCenter distinction

No new tables needed. MigrationJob already has `sourceType` and `sourceConnectionId`.

---

## Preflight Checks

Before launching any virt-v2v migration, the system runs preflight checks via SSH on the target Proxmox node:

### Required Packages Check

```bash
# Check virt-v2v
which virt-v2v

# Check pv
which pv
```

If either is missing, display a warning in the migration dialog:

> "The packages `virt-v2v` and `pv` are required on the target Proxmox node for this migration type. [Install now]"

The "Install now" button executes via SSH:
```bash
apt-get update && apt-get install -y virt-v2v pv
```

Requires SSH with sudo configured on the PVE connection (already a prerequisite for migrations).

### Disk Space Check

```bash
df -B1 /tmp | tail -1 | awk '{print $4}'
```

Compare available space with total disk size of the VM to migrate. Warn if insufficient (virt-v2v writes converted disks to temp directory before import).

### Existing Preflight Checks (kept)

- SSH connectivity (`echo ok`)
- sshfs/sshpass availability (for ESXi direct only)
- PVE API reachability

---

## virt-v2v Execution

### Command Construction

**vCenter:**
```bash
virt-v2v \
  -ic 'vpx://user@vcenter.example.com/Datacenter/host/esxi-host?no_verify=1' \
  -ip /tmp/v2v-pwfile-<jobid> \
  "<VM_NAME>" \
  -o local \
  -os /tmp/v2v-<jobid>/ \
  --machine-readable \
  2>&1
```

The password file (`-ip`) contains the vCenter password, created before execution and deleted after.

**Hyper-V (direct):**
```bash
virt-v2v \
  -ic 'hyperv://user@hyperv-host' \
  -ip /tmp/v2v-pwfile-<jobid> \
  "<VM_NAME>" \
  -o local \
  -os /tmp/v2v-<jobid>/ \
  --machine-readable \
  2>&1
```

**Disk-based (Nutanix, Hyper-V fallback):**
```bash
virt-v2v \
  -i disk /tmp/nutanix-<jobid>/disk-0.qcow2 \
  -o local \
  -os /tmp/v2v-<jobid>/ \
  --machine-readable \
  2>&1
```

### Progress Parsing

virt-v2v with `--machine-readable` outputs structured progress to stderr:

```
[   3.0%] Copying disk 1/2
[  45.0%] Copying disk 1/2
[ 100.0%] Copying disk 1/2
[   0.0%] Copying disk 2/2
...
```

The pipeline parses these lines in real-time via SSH stream and updates the MigrationJob record:
- `progress`: percentage (0-100), weighted across disks
- `currentStep`: "Copying disk 1/2", "Converting guest", etc.
- `logs`: append each significant line

### Disk Import Phase

After virt-v2v completes, the output directory contains:
- `<name>-sda` (first disk, qcow2 or raw)
- `<name>-sdb` (second disk, if any)
- `<name>.xml` (libvirt domain XML with VM metadata)

For each disk:

**Block storage (LVM, ZFS, RBD):**
```bash
SIZE=$(stat -c %s /tmp/v2v-<jobid>/<name>-sda)
pvesm alloc <storage> <vmid> vm-<vmid>-disk-0 $((SIZE / 1024))K
DEVICE=$(pvesm path <storage>:<vmid>/vm-<vmid>-disk-0)
pv /tmp/v2v-<jobid>/<name>-sda | dd of=$DEVICE bs=4M oflag=direct
```

**File-based storage (NFS, dir, CephFS):**
```bash
qm disk import <vmid> /tmp/v2v-<jobid>/<name>-sda <storage> --format qcow2
```

Progress tracked via `pv` output (bytes/sec, ETA, percentage).

---

## VM Configuration from virt-v2v XML

virt-v2v produces a libvirt domain XML. The `v2vConfigMapper.ts` module parses it to extract:

| XML Element | Proxmox Config |
|---|---|
| `<memory>` | `memory` (MB) |
| `<vcpu>` | `cores` |
| `<os><type>hvm</type><loader type="pflash">` | `bios: ovmf` + EFI disk |
| `<os><type>hvm</type>` (no loader) | `bios: seabios` |
| `<devices><interface><model type="virtio">` | `net0: virtio` |
| `<devices><disk><target dev="sda">` | `scsi0` disk attachment |
| `<features><acpi/><apic/>` | Standard (always enabled) |

For fields not in the XML, use sensible defaults:
- Machine type: `q35`
- SCSI controller: `virtio-scsi-single`
- OS type: detected from source VM guest OS string

---

## Source API Clients

### vCenter VM Listing

Extend existing SOAP client (`src/lib/vmware/soap.ts`) to work with vCenter URLs (not just ESXi). vCenter uses the same SOAP API (`/sdk`) but with a different inventory structure (Datacenter > Cluster > Host > VM).

Changes needed:
- `soapLogin()`: support vCenter URLs (same endpoint, different service instance)
- `listVMs()`: traverse the vCenter inventory hierarchy
- Path resolution: `vpx://user@host/Datacenter/host/esxi-host` format

### Nutanix Prism Client (new)

`src/lib/nutanix/client.ts`:

```typescript
// Prism v3 REST API
class NutanixClient {
  // POST /api/nutanix/v3/vms/list - List all VMs
  async listVMs(): Promise<NutanixVM[]>
  
  // GET /api/nutanix/v3/vms/{uuid} - VM details
  async getVM(uuid: string): Promise<NutanixVM>
  
  // POST /api/nutanix/v3/vm_snapshots - Create snapshot
  async createSnapshot(vmUuid: string): Promise<string>
  
  // GET /api/nutanix/v3/vms/{uuid}/disk_list - List disks
  async listDisks(vmUuid: string): Promise<NutanixDisk[]>
  
  // Download disk image (qcow2) via snapshot
  async downloadDisk(vmUuid: string, diskUuid: string, destPath: string): Promise<void>
}
```

Authentication: Basic auth over HTTPS (same pattern as XCP-ng client).

### Hyper-V VM Listing

For v1, rely on virt-v2v's own enumeration or manual configuration. No custom Hyper-V API client in v1. The user provides the VM name and virt-v2v handles the connection.

If virt-v2v cannot connect directly to Hyper-V (common in practice), the user exports VHDX files to an NFS share accessible from the Proxmox node, and selects the disk files in the wizard.

---

## API Routes

### New Routes

```
GET  /api/v1/vcenter/[id]/vms          - List VMs on vCenter (reuses SOAP client)
GET  /api/v1/vcenter/[id]/vms/[vmid]   - VM detail from vCenter
GET  /api/v1/vcenter/[id]/status        - vCenter connection status

GET  /api/v1/nutanix/[id]/vms          - List VMs via Prism API
GET  /api/v1/nutanix/[id]/vms/[vmid]   - VM detail from Prism
GET  /api/v1/nutanix/[id]/status        - Prism connection status

POST /api/v1/migrations                 - Extended: accepts sourceType 'vcenter', 'hyperv', 'nutanix'
```

### Hyper-V Routes

No dedicated listing route for v1. The migration POST route accepts `sourceType: 'hyperv'` with either:
- `vmName` + connection ID (virt-v2v connects directly)
- `diskPaths` array (user-provided VHDX paths on accessible storage)

---

## UI Changes

### ConnectionDialog

Add to the connection type selector:
- VMware section: sub-radio "ESXi (Direct)" / "vCenter"
  - vCenter shows additional field: Datacenter path
  - ESXi shows existing SSH fields
- New entry: "Hyper-V" with host/user/password fields
- New entry: "Nutanix" with Prism URL/user/password fields

### InventoryTree

External hypervisors section already supports multiple types. Add:
- vCenter connections: show under VMware with vCenter icon
- Hyper-V connections: new icon (`ri-microsoft-line` or custom SVG)
- Nutanix connections: new icon (custom SVG)

### Migration Wizard Dialog

The existing migration dialog supports ESXi and XCP-ng. Extend:
- For vCenter/Hyper-V/Nutanix sources, hide "Migration Type" selector (cold only) and "Transfer Mode" selector (virt-v2v handles it)
- Show info banner: "This migration requires the VM to be powered off on the source. virt-v2v will handle disk conversion and virtio driver injection automatically."
- Preflight section: show virt-v2v + pv install status with "Install" button
- Disk space warning if insufficient temp space on target node

### MigrationDashboard

Add type colors and labels:
- `vcenter`: VMware orange (same as ESXi)
- `hyperv`: Microsoft blue
- `nutanix`: Nutanix green

Donut chart groups vCenter with VMware ESXi under "VMware" category.

---

## New Files

| File | Purpose |
|---|---|
| `src/lib/migration/v2v-pipeline.ts` | virt-v2v orchestration pipeline (vCenter, Hyper-V, Nutanix) |
| `src/lib/migration/v2vConfigMapper.ts` | Parse libvirt XML output to Proxmox VM config |
| `src/lib/nutanix/client.ts` | Nutanix Prism v3 REST API client |
| `src/app/api/v1/vcenter/[id]/vms/route.ts` | vCenter VM listing route |
| `src/app/api/v1/vcenter/[id]/vms/[vmid]/route.ts` | vCenter VM detail route |
| `src/app/api/v1/vcenter/[id]/status/route.ts` | vCenter connection status route |
| `src/app/api/v1/nutanix/[id]/vms/route.ts` | Nutanix VM listing route |
| `src/app/api/v1/nutanix/[id]/vms/[vmid]/route.ts` | Nutanix VM detail route |
| `src/app/api/v1/nutanix/[id]/status/route.ts` | Nutanix connection status route |

## Modified Files

| File | Changes |
|---|---|
| `src/lib/vmware/soap.ts` | Extend for vCenter inventory traversal |
| `src/components/settings/ConnectionDialog.tsx` | Add vCenter sub-type, Hyper-V, Nutanix types |
| `src/app/api/v1/migrations/route.ts` | Handle new sourceTypes, route to v2v-pipeline |
| `src/app/(dashboard)/infrastructure/inventory/InventoryDetails.tsx` | Migration dialog: hide live options for v2v types, add preflight UI |
| `src/app/(dashboard)/infrastructure/inventory/InventoryTree.tsx` | External hypervisor icons for new types |
| `src/app/(dashboard)/infrastructure/inventory/MigrationDashboard.tsx` | Colors/labels for new types |
| `prisma/schema.prisma` | Add `subType` field to Connection model |

---

## Error Handling

| Error | Handling |
|---|---|
| virt-v2v not installed | Preflight blocks migration, offers install button |
| pv not installed | Preflight blocks migration, offers install button |
| Insufficient temp disk space | Preflight warns with required vs available space |
| virt-v2v exits non-zero | Capture full stderr in MigrationJob logs, set status `failed` |
| SSH disconnects during virt-v2v | Process continues on node (launched with `nohup`). Reconnect and check `/tmp/v2v-<jobid>/` for output. |
| vCenter auth failure | virt-v2v reports "could not connect to libvirt" - parse and surface as "Invalid vCenter credentials" |
| Nutanix API failure | Client throws, caught by pipeline, logged |
| Disk import failure | `qm disk import` / `dd` exit code checked, logged |
| Temp file cleanup on failure | Always attempt `rm -rf /tmp/v2v-<jobid>/` in finally block |
| Password file security | Created with `chmod 600`, deleted immediately after virt-v2v completes |

---

## Limitations (v1)

1. **Cold migration only** - VM source must be powered off (or snapshot-based). No live/delta sync.
2. **No VDDK** - vCenter disk access via HTTPS (slower). vSAN not supported in v1.
3. **Hyper-V limited** - Depends on virt-v2v's Hyper-V support quality. Fallback to manual VHDX export.
4. **Temp disk space required** - Equal to VM disk size on the target Proxmox node.
5. **virt-v2v version** - Debian Bookworm (PVE 8) ships v2.2. Some features (parallel copy, Windows Server 2025) require newer versions.
6. **No batch parallel** - virt-v2v runs one VM at a time per node. Batch migrations are sequential (same as current pipelines).

## Future Considerations (v2+)

- VDDK support for vSAN migrations
- Near-zero downtime mode (snapshot + delta sync)
- Parallel disk copying (`--parallel=N`, requires virt-v2v >= 2.8)
- Direct connection to Hyper-V via WinRM/PowerShell API
- Nutanix Move API integration
- Progress granularity improvements
- Resume/retry for interrupted virt-v2v transfers
