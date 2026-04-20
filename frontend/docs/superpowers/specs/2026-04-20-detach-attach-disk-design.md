# Detach / Attach Disk — Design Spec

**Date**: 2026-04-20
**Scope**: ProxCenter frontend (`proxcenter-frontend/frontend`)
**Status**: Approved for implementation
**Issue**: [#259 — Detach/Attach disk to/from VM](https://github.com/adminsyspro/proxcenter-ui/issues/259)

## Goal

Give users the ability to detach a disk from a running or stopped VM (converting it to an `unusedN` entry) and to re-attach an `unusedN` disk on a different bus/slot (SCSI ↔ IDE ↔ SATA ↔ VirtIO). This mirrors the Proxmox VE native Hardware panel and is needed during migrations where the bus type must change.

Applies to QEMU VMs only.

## Non-Goals (v1)

- No changes to LXC containers (their `mpN` / `rootfs` entries don't have the same detach semantics).
- No "Reassign Owner" (move a disk to a different VM) — separate feature.
- No new backend route. Everything rides on the existing `PUT /config` and the already-whitelisted `unused\d+` patterns.
- No batch detach/attach. One disk at a time.

## Background / Current State

1. `handleDeleteDisk` in `src/app/(dashboard)/infrastructure/inventory/hooks/useHardwareHandlers.ts` sends `PUT /config { delete: diskId }`. In PVE, this moves an active disk to `unusedN` (keeps the volume) — it is **de facto a Detach**, mislabeled "Delete". When applied to an `unusedN` entry, PVE frees the volume (since it's no longer referenced) — that matches a real Delete.
2. `EditDiskDialog.tsx` already implements the full Attach flow for `unusedN` disks (`handleReassign`, lines 427-441): bus selector, auto next-free index, PUT config `{ [targetId]: disk.rawValue, delete: disk.id }`. UI is reachable today by clicking an `unusedN` row.
3. Disks are listed in `VmDetailTabs.tsx` lines 1380-1443 (clickable rows opening `EditDiskDialog`). `unusedN` entries already render with a yellow "unused" chip.

What's missing:
- No explicit "Detach" affordance on **active** disk rows — the action is only discoverable by clicking through to the dialog and using the red "Delete" button, whose label misleads users about the outcome.
- Attach/Delete on `unused` rows require opening the dialog — one extra click versus inline buttons.

## Design

### User-visible behavior

| Disk state | Actions |
|---|---|
| Active (scsi/virtio/sata/ide, CD-ROM, EFI, TPM) | Row click opens `EditDiskDialog` (unchanged). New **⋮ kebab menu** on the right of the row with: **Edit**, **Resize**, **Move storage**, **Detach**. No "Delete" — a disk must be detached before it can be destroyed. |
| `unusedN` | Row click opens `EditDiskDialog` (unchanged). Two new **inline icon buttons** on the right: **Attach** (`ri-link`) and **Delete** (`ri-delete-bin-line`). |

Rationale: users asked for speed (no dialog round-trip for common actions) while keeping the existing rich editor accessible via row click.

### API payloads (all `PUT /config`)

| Action | Payload | PVE behavior |
|---|---|---|
| Detach active | `{ delete: "scsi0" }` | Moves volume to first free `unusedN`, keeps data. |
| Attach unused | `{ scsi1: "local:100/vm-100-disk-0.raw", delete: "unused0" }` | Assigns volume to the target bus+index, removes the `unused0` entry. |
| Delete unused | `{ delete: "unused0" }` | Destroys the volume (no remaining reference). |

No new backend route. Boot-order cleanup (already in `handleDeleteDisk`) must be preserved for Detach — detaching a disk listed in `boot: order=...` fails with "is a boot device" otherwise.

### Frontend changes

**`useHardwareHandlers.ts`**
- Rename `handleDeleteDisk` → `handleDetachDisk`. Body is identical (PUT `{ delete: selectedDisk.id }` + boot-order cleanup). This is the correct semantic for both "detach active → unused" and "delete unused → destroy" because PVE's `delete` param does both depending on source state. A single handler covers both.
- No new attach helper in v1. The existing `handleReassign` inside `EditDiskDialog` already performs the attach (PUT config `{ [targetId]: disk.rawValue, delete: unusedId }`) and is reached by clicking the new inline **Attach icon** on an unused row, which just opens the dialog.

**`VmDetailTabs.tsx`** (Disks card, lines 1380-1443)
- Replace the decorative `ri-pencil-line` at the end of each active-disk row with:
  - An `IconButton` rendering `ri-more-2-fill` (⋮) that opens a `Menu` with items: Edit, Resize, Move Storage, Detach.
  - Each item stops click propagation and drives state: `setSelectedDisk(disk); setEditDiskDialogOpen(true); setInitialTab(<n>)` for Edit/Resize/Move; Detach triggers a MUI confirm dialog then `handleDetachDisk`.
- For `unusedN` rows, replace the trailing pencil icon with two `IconButton`s:
  - **Attach** (`ri-link`) → opens `EditDiskDialog` (the existing unused-variant already shows the reassign form).
  - **Delete** (`ri-delete-bin-line`, red) → opens a MUI confirm dialog, then calls `handleDetachDisk` (which destroys the volume because the entry is unused).
- Both new control groups must `e.stopPropagation()` so clicking them doesn't also trigger the row's `onClick` that opens the edit dialog.

**`EditDiskDialog.tsx`**
- Relabel the red "Delete" button on the **regular disk** variant to **"Detach"** (icon `ri-link-unlink` instead of `ri-delete-bin-line`). Confirm-dialog title becomes "Detach disk", body explains the volume will be kept as `unusedN`.
- **CDROM variant** keeps its current "Delete" label and behavior unchanged — CD/DVD drives don't meaningfully go to `unusedN`; removing them just strips the entry from config. (See Risks section.)
- The **unused variant**'s "Delete" button keeps its current label and red styling — on unused disks the action really does destroy the volume.
- Add an optional `initialTab?: number` prop so the new kebab menu items (Resize / Move) can open the dialog on the correct tab directly.

**Confirmation dialogs**
- Every destructive action (Detach, Delete unused) uses a **MUI `Dialog`**, never `window.confirm()` (per `feedback_modals_mui.md`).
- Detach confirm: title "Detach disk", body "The disk `scsi0` will be detached from VM and moved to `unused`. The data is kept. You can re-attach it later."
- Delete-unused confirm: title "Delete unused disk", body "This permanently destroys the volume `local:100/vm-100-disk-0.raw`. This cannot be undone."

### i18n

New keys in `en`, `fr`, `de`, `zh-CN` (per `feedback_always_i18n.md` — no `defaultMessage` fallback):

| Key | EN |
|---|---|
| `hardware.detach` | Detach |
| `hardware.detachTitle` | Detach disk |
| `hardware.detachConfirm` | The disk `{id}` will be detached from the VM and kept as an unused volume. Data is preserved. |
| `hardware.attach` | Attach |
| `hardware.deleteUnusedTitle` | Delete unused disk |
| `hardware.deleteUnusedConfirm` | Permanently destroy volume `{volume}`? This cannot be undone. |
| `hardware.slotTaken` | Slot `{target}` is already in use. |

Existing `hardware.confirmDeleteTitle` / `hardware.confirmDeleteDisk` remain — they are reused by the unused-disk delete path.

### Error handling

- **Slot collision** (user tries to attach to e.g. `scsi1` which already exists): PVE returns 400 with a descriptive error. The dialog surfaces `err.error` in the existing `<Alert severity="error">`. No client-side pre-validation beyond the auto-next-free default.
- **Boot device detach**: boot-order cleanup is applied transparently before the PUT (existing logic in `handleDeleteDisk`, now `handleDetachDisk`).
- **VM locked / running restriction**: detach on a running VM with an actively-used disk may fail — surface PVE error.

## File Change List

| File | Change |
|---|---|
| `src/app/(dashboard)/infrastructure/inventory/hooks/useHardwareHandlers.ts` | Rename `handleDeleteDisk` → `handleDetachDisk`. Update all call sites in the same file. |
| `src/app/(dashboard)/infrastructure/inventory/hooks/useHardware.ts` (if it re-exports) | Update export name. |
| `src/app/(dashboard)/infrastructure/inventory/tabs/VmDetailTabs.tsx` | Add kebab menu on active disk rows; add Attach/Delete inline icons on unused rows; wire confirm dialogs. |
| `src/components/hardware/EditDiskDialog.tsx` | Relabel active-disk delete button to "Detach"; update confirm dialog copy; add `initialTab?: number` prop. |
| `src/components/hardware/DetachConfirmDialog.tsx` | New — small MUI confirm dialog for Detach. |
| `src/components/hardware/DeleteUnusedDiskDialog.tsx` | New — small MUI confirm dialog for destroying an unused volume. |
| `public/locales/en.json`, `fr.json`, `de.json`, `zh-CN.json` | Add the 7 new i18n keys above. |

## Out of Scope — Verified

- **LXC**: confirmed not applicable.
- **Reassign Owner (cross-VM disk move)**: not requested in #259.
- **Touching the existing `Add Disk` flow**: unchanged.
- **Frontend tests**: no test harness for these components in the repo today.

## Risks

- **GitNexus impact analysis** must be run on `handleDeleteDisk` before renaming — there may be callers in `useHardware.ts`, `VmDetailTabs.tsx`, or elsewhere that need updating. Safe renames should use `gitnexus_rename` per repo policy.
- **Boot-order edge case**: if a disk is in `boot: order=...` and the cleanup PUT fails silently (existing `try/catch` in `handleDeleteDisk`), the subsequent Detach PUT will surface PVE's "is a boot device" error. This mirrors current "Delete" behavior — no regression introduced.
- **CDROM Detach**: CD/DVD drives can also be "detached" via the same payload. Confirm with user whether to expose Detach on CDROM rows or keep only Delete there (CDROMs don't really go to `unusedN` — they get removed entirely). **v1 decision**: keep CDROM behavior as-is (label stays "Delete" in the CDROM dialog variant), no kebab menu on CDROM rows.
