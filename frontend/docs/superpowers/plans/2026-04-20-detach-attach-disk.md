# Detach / Attach Disk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an explicit Detach action on active VM disks and inline Attach/Delete icon buttons on unused disks, mirroring the PVE Hardware panel — per issue [#259](https://github.com/adminsyspro/proxcenter-ui/issues/259).

**Architecture:** No new backend route. Reuse existing `PUT /api/v1/.../config` — PVE handles the `delete=diskId` semantic difference (active → unused vs unused → destroy). Rename the de-facto detach handler, add two small MUI confirm dialogs, relabel a button, and extend the Disks card in `VmDetailTabs.tsx` with a kebab menu on active rows and inline icons on unused rows. Attach flow reuses the already-working `handleReassign` inside `EditDiskDialog`.

**Tech Stack:** Next.js 16 / React 19 / TypeScript 5 / MUI 7 / RemixIcon / next-intl JSON messages (`src/messages/{en,fr,de,zh-CN}.json`). Repo index: GitNexus (`proxcenter-frontend`).

**Branch:** `main` (per user request).

**Spec:** [`docs/superpowers/specs/2026-04-20-detach-attach-disk-design.md`](../specs/2026-04-20-detach-attach-disk-design.md)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/messages/{en,fr,de,zh-CN}.json` | Modify | New i18n keys under `hardware.*` |
| `src/app/(dashboard)/infrastructure/inventory/hooks/useHardwareHandlers.ts` | Modify | Rename `handleDeleteDisk` → `handleDetachDisk` |
| `src/app/(dashboard)/infrastructure/inventory/components/InventoryDialogs.tsx` | Modify | Update prop type + destructure + prop-drill |
| `src/app/(dashboard)/infrastructure/inventory/InventoryDetails.tsx` | Modify | Update destructure + prop-drill |
| `src/components/hardware/DetachConfirmDialog.tsx` | Create | Small MUI confirm for Detach (active disk → unused) |
| `src/components/hardware/DeleteUnusedDiskDialog.tsx` | Create | Small MUI confirm for Delete (unused → destroyed) |
| `src/components/hardware/EditDiskDialog.tsx` | Modify | Relabel "Delete" → "Detach" on regular disk variant; add optional `initialTab` prop |
| `src/app/(dashboard)/infrastructure/inventory/tabs/VmDetailTabs.tsx` | Modify | Replace trailing pencil icon with kebab menu (active) or Attach+Delete icons (unused) |

---

## Task 1: Add i18n keys

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/fr.json`
- Modify: `src/messages/de.json`
- Modify: `src/messages/zh-CN.json`

Ship i18n first so later tasks can reference real keys (per `feedback_always_i18n.md` — no `defaultMessage` fallback).

- [ ] **Step 1: Locate the `hardware` namespace in each locale file**

Run:
```bash
grep -n '"hardware"' /root/saas/proxcenter-frontend/frontend/src/messages/en.json
```

Expected: a line showing the opening of the `hardware` object (approx. line number varies — note it for each file).

- [ ] **Step 2: Add the 9 new keys to `en.json`**

Inside the existing `"hardware": { ... }` object, add:

```json
"detach": "Detach",
"detachTitle": "Detach disk",
"detachConfirm": "The disk {id} will be detached from the VM and kept as an unused volume. Data is preserved.",
"attach": "Attach",
"deleteUnusedTitle": "Delete unused disk",
"deleteUnusedConfirm": "Permanently destroy volume {volume}? This cannot be undone.",
"slotTaken": "Slot {target} is already in use.",
"resize": "Resize",
"moveStorage": "Move storage"
```

- [ ] **Step 3: Add the same 9 keys to `fr.json`**

```json
"detach": "Détacher",
"detachTitle": "Détacher le disque",
"detachConfirm": "Le disque {id} va être détaché de la VM et conservé comme volume inutilisé. Les données sont préservées.",
"attach": "Attacher",
"deleteUnusedTitle": "Supprimer le disque inutilisé",
"deleteUnusedConfirm": "Détruire définitivement le volume {volume} ? Cette action est irréversible.",
"slotTaken": "Le slot {target} est déjà utilisé.",
"resize": "Redimensionner",
"moveStorage": "Déplacer le stockage"
```

- [ ] **Step 4: Add the same 9 keys to `de.json`**

```json
"detach": "Trennen",
"detachTitle": "Festplatte trennen",
"detachConfirm": "Die Festplatte {id} wird von der VM getrennt und als nicht verwendetes Volume beibehalten. Die Daten bleiben erhalten.",
"attach": "Verbinden",
"deleteUnusedTitle": "Nicht verwendete Festplatte löschen",
"deleteUnusedConfirm": "Volume {volume} dauerhaft löschen? Dies kann nicht rückgängig gemacht werden.",
"slotTaken": "Slot {target} ist bereits belegt.",
"resize": "Größe ändern",
"moveStorage": "Speicher verschieben"
```

- [ ] **Step 5: Add the same 9 keys to `zh-CN.json`**

```json
"detach": "分离",
"detachTitle": "分离磁盘",
"detachConfirm": "磁盘 {id} 将从虚拟机分离并保留为未使用卷。数据将被保留。",
"attach": "附加",
"deleteUnusedTitle": "删除未使用的磁盘",
"deleteUnusedConfirm": "永久销毁卷 {volume}？此操作不可撤销。",
"slotTaken": "插槽 {target} 已被占用。",
"resize": "调整大小",
"moveStorage": "移动存储"
```

- [ ] **Step 6: Verify all 4 files parse as valid JSON**

Run:
```bash
for f in en fr de zh-CN; do \
  node -e "JSON.parse(require('fs').readFileSync('/root/saas/proxcenter-frontend/frontend/src/messages/${f}.json','utf8'))" \
  && echo "$f OK" || echo "$f FAIL"; \
done
```

Expected: `en OK`, `fr OK`, `de OK`, `zh-CN OK`.

- [ ] **Step 7: Commit**

```bash
cd /root/saas/proxcenter-frontend && git add frontend/src/messages/en.json frontend/src/messages/fr.json frontend/src/messages/de.json frontend/src/messages/zh-CN.json && git commit -m "feat(i18n): add detach/attach/delete-unused keys for disk management"
```

---

## Task 2: Run GitNexus impact, then rename `handleDeleteDisk` → `handleDetachDisk`

**Files:**
- Modify: `src/app/(dashboard)/infrastructure/inventory/hooks/useHardwareHandlers.ts`
- Modify: `src/app/(dashboard)/infrastructure/inventory/components/InventoryDialogs.tsx`
- Modify: `src/app/(dashboard)/infrastructure/inventory/InventoryDetails.tsx`

Per CLAUDE.md, impact analysis is mandatory before renaming a symbol.

- [ ] **Step 1: Run impact analysis**

Use the `mcp__gitnexus__impact` tool:
```json
{ "target": "handleDeleteDisk", "direction": "upstream" }
```

Expected: a list of direct callers (d=1). The known callers are the 3 files above. If the graph reports any additional d=1 dependent, update this plan before proceeding. Do NOT proceed if a HIGH or CRITICAL risk is reported without explicit re-confirmation.

- [ ] **Step 2: Use `mcp__gitnexus__rename` in dry-run mode**

```json
{ "symbol_name": "handleDeleteDisk", "new_name": "handleDetachDisk", "dry_run": true }
```

Expected: preview listing edits in the 3 known files. Review the `text_search` edits (rename tool flags those as needing manual review). Look specifically for false positives (e.g., a comment mentioning "delete disk").

- [ ] **Step 3: Execute the rename**

```json
{ "symbol_name": "handleDeleteDisk", "new_name": "handleDetachDisk", "dry_run": false }
```

- [ ] **Step 4: Verify no occurrences of `handleDeleteDisk` remain**

Run:
```bash
grep -rn "handleDeleteDisk" /root/saas/proxcenter-frontend/frontend/src
```

Expected: zero matches.

- [ ] **Step 5: Verify TypeScript compiles**

Run:
```bash
cd /root/saas/proxcenter-frontend/frontend && npx tsc --noEmit 2>&1 | grep -E "handleDetachDisk|handleDeleteDisk" || echo "clean"
```

Expected: `clean` (no errors mentioning either symbol).

- [ ] **Step 6: Commit**

```bash
cd /root/saas/proxcenter-frontend && git add frontend/src/app frontend/src/components && git commit -m "refactor: rename handleDeleteDisk to handleDetachDisk (semantic fix)"
```

---

## Task 3: Create `DetachConfirmDialog` component

**Files:**
- Create: `src/components/hardware/DetachConfirmDialog.tsx`

Extract the Detach confirm into a standalone, reusable component so both the kebab menu (Task 6) and the `EditDiskDialog` relabel (Task 5) can reuse it.

- [ ] **Step 1: Create the file**

Write to `/root/saas/proxcenter-frontend/frontend/src/components/hardware/DetachConfirmDialog.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Box, Typography, Button, CircularProgress, Alert
} from '@mui/material'

interface DetachConfirmDialogProps {
  open: boolean
  diskId: string
  onClose: () => void
  onConfirm: () => Promise<void>
}

export function DetachConfirmDialog({ open, diskId, onClose, onConfirm }: DetachConfirmDialogProps) {
  const t = useTranslations()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConfirm = async () => {
    setWorking(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Error')
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog open={open} onClose={working ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
        <Box sx={{ width: 36, height: 36, borderRadius: 1, bgcolor: 'warning.main', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className="ri-link-unlink" style={{ fontSize: 20, color: '#fff' }} />
        </Box>
        {t('hardware.detachTitle')}
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Typography variant="body2">
          {t('hardware.detachConfirm', { id: diskId })}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={working}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          color="warning"
          onClick={handleConfirm}
          disabled={working}
          startIcon={working ? <CircularProgress size={16} color="inherit" /> : <i className="ri-link-unlink" />}
        >
          {t('hardware.detach')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd /root/saas/proxcenter-frontend/frontend && npx tsc --noEmit 2>&1 | grep "DetachConfirmDialog" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
cd /root/saas/proxcenter-frontend && git add frontend/src/components/hardware/DetachConfirmDialog.tsx && git commit -m "feat(hardware): add DetachConfirmDialog component"
```

---

## Task 4: Create `DeleteUnusedDiskDialog` component

**Files:**
- Create: `src/components/hardware/DeleteUnusedDiskDialog.tsx`

- [ ] **Step 1: Create the file**

Write to `/root/saas/proxcenter-frontend/frontend/src/components/hardware/DeleteUnusedDiskDialog.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Box, Typography, Button, CircularProgress, Alert
} from '@mui/material'

interface DeleteUnusedDiskDialogProps {
  open: boolean
  diskId: string
  volume: string
  onClose: () => void
  onConfirm: () => Promise<void>
}

export function DeleteUnusedDiskDialog({ open, diskId, volume, onClose, onConfirm }: DeleteUnusedDiskDialogProps) {
  const t = useTranslations()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConfirm = async () => {
    setWorking(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Error')
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog open={open} onClose={working ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
        <Box sx={{ width: 36, height: 36, borderRadius: 1, bgcolor: 'error.main', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className="ri-delete-bin-line" style={{ fontSize: 20, color: '#fff' }} />
        </Box>
        {t('hardware.deleteUnusedTitle')}
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Typography variant="body2" sx={{ mb: 1 }}>
          {t('hardware.deleteUnusedConfirm', { volume })}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {diskId}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={working}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          color="error"
          onClick={handleConfirm}
          disabled={working}
          startIcon={working ? <CircularProgress size={16} color="inherit" /> : <i className="ri-delete-bin-line" />}
        >
          {t('common.delete')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd /root/saas/proxcenter-frontend/frontend && npx tsc --noEmit 2>&1 | grep "DeleteUnusedDiskDialog" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
cd /root/saas/proxcenter-frontend && git add frontend/src/components/hardware/DeleteUnusedDiskDialog.tsx && git commit -m "feat(hardware): add DeleteUnusedDiskDialog component"
```

---

## Task 5: Relabel `EditDiskDialog` regular-disk Delete → Detach, add `initialTab` prop

**Files:**
- Modify: `src/components/hardware/EditDiskDialog.tsx`

Two changes:
1. On the **regular disk** variant only, change the red "Delete" button to "Detach" (different label, different confirm dialog). CDROM and Unused variants keep their current buttons.
2. Add an `initialTab?: number` prop so the upcoming kebab menu (Task 6) can open the dialog on Resize (tab 2) or Move (tab 3) directly.

- [ ] **Step 1: Run impact analysis on `EditDiskDialog`**

Use `mcp__gitnexus__impact`:
```json
{ "target": "EditDiskDialog", "direction": "upstream" }
```

Expected: list of direct importers. Confirm the known callers (`InventoryDialogs.tsx`, `HardwareModals.tsx` barrel export). No proceeding if d=1 count is unexpectedly high.

- [ ] **Step 2: Add `initialTab` to the props interface**

In `src/components/hardware/EditDiskDialog.tsx`, find the `EditDiskDialogProps` interface (around line 40-60 — the one containing `onDelete: () => Promise<void>`). Add:

```ts
initialTab?: number
```

- [ ] **Step 3: Use `initialTab` to seed the `tab` state**

Find the line that initializes `tab` state (approx. `const [tab, setTab] = useState(0)`). Change to:

```ts
const [tab, setTab] = useState(initialTab ?? 0)
```

And add this effect near the other `useEffect`s so the dialog respects `initialTab` changes when re-opened:

```ts
useEffect(() => {
  if (open) setTab(initialTab ?? 0)
}, [open, initialTab])
```

- [ ] **Step 4: Update the function signature to destructure `initialTab`**

Find the component signature (around line 83):

```ts
export function EditDiskDialog({ open, onClose, onSave, onDelete, onResize, onMoveStorage, connId, node, disk, existingDisks, availableStorages }: EditDiskDialogProps) {
```

Change to:

```ts
export function EditDiskDialog({ open, onClose, onSave, onDelete, onResize, onMoveStorage, connId, node, disk, existingDisks, availableStorages, initialTab }: EditDiskDialogProps) {
```

- [ ] **Step 5: Import DetachConfirmDialog at the top**

Add to the imports (keep alphabetical or grouped with other local imports):

```ts
import { DetachConfirmDialog } from './DetachConfirmDialog'
```

- [ ] **Step 6: Add Detach confirm state**

Near `const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)` (~line 443), add:

```ts
const [confirmDetachOpen, setConfirmDetachOpen] = useState(false)
```

- [ ] **Step 7: Add the Detach confirm dialog element**

Just before the existing `deleteConfirmDialog` const (~line 476), add a sibling:

```ts
const detachConfirmDialog = disk ? (
  <DetachConfirmDialog
    open={confirmDetachOpen}
    diskId={disk.id}
    onClose={() => setConfirmDetachOpen(false)}
    onConfirm={async () => { await onDelete() }}
  />
) : null
```

(`onDelete` is the existing prop — after the rename in Task 2 it calls `handleDetachDisk`, which is exactly the detach payload.)

- [ ] **Step 8: Render `detachConfirmDialog` alongside `deleteConfirmDialog` in the regular-disk return path only**

Find the regular-disk variant return (approx. line 673-675):

```tsx
return (
  <>{deleteConfirmDialog}<Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
```

Change to:

```tsx
return (
  <>{detachConfirmDialog}<Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
```

(Drop `deleteConfirmDialog` here — regular disks no longer expose Delete. The `deleteConfirmDialog` fragment is still used by the CDROM and Unused variants, unchanged.)

- [ ] **Step 9: Retarget the regular-disk red bottom-left button from Delete → Detach**

Find the regular-disk `DialogActions` block (search for the last `onClick={handleDelete}` in the file, approx. line 941). The button currently reads:

```tsx
<Button
  color="error"
  onClick={handleDelete}
  disabled={isWorking}
  startIcon={deleting ? <CircularProgress size={16} /> : <i className="ri-delete-bin-line" />}
>
  {t('common.delete')}
</Button>
```

Replace with:

```tsx
<Button
  color="warning"
  onClick={() => setConfirmDetachOpen(true)}
  disabled={isWorking}
  startIcon={deleting ? <CircularProgress size={16} /> : <i className="ri-link-unlink" />}
>
  {t('hardware.detach')}
</Button>
```

(CDROM and Unused variants keep their `handleDelete` Delete buttons unchanged.)

- [ ] **Step 10: Verify TypeScript compiles**

Run:
```bash
cd /root/saas/proxcenter-frontend/frontend && npx tsc --noEmit 2>&1 | grep -E "EditDiskDialog|DetachConfirm|initialTab" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 11: Commit**

```bash
cd /root/saas/proxcenter-frontend && git add frontend/src/components/hardware/EditDiskDialog.tsx && git commit -m "feat(hardware): relabel regular-disk Delete as Detach; add initialTab prop"
```

---

## Task 6: Add kebab menu on active disk rows in `VmDetailTabs.tsx`

**Files:**
- Modify: `src/app/(dashboard)/infrastructure/inventory/tabs/VmDetailTabs.tsx`

Replace the decorative `ri-pencil-line` trailing icon on **active, non-unused** rows with a kebab `IconButton` that opens a MUI `Menu` with: **Edit**, **Resize**, **Move storage**, **Detach**.

- [ ] **Step 1: Run impact analysis on `VmDetailTabs`**

Use `mcp__gitnexus__impact`:
```json
{ "target": "VmDetailTabs", "direction": "upstream" }
```

Expected: direct callers (`InventoryDetails.tsx` region). Verify no HIGH/CRITICAL warning.

- [ ] **Step 2: Add new state and imports in `VmDetailTabs.tsx`**

At the top of `VmDetailTabs.tsx`, ensure `Menu`, `MenuItem`, `IconButton`, `Divider`, `ListItemIcon` are in the MUI import block. Then add these local imports near the other hardware dialog imports:

```ts
import { DetachConfirmDialog } from '@/components/hardware/DetachConfirmDialog'
```

Inside the component, add the kebab-menu state near the other disk-related state (search for `editDiskDialogOpen` to find the right location):

```ts
const [diskMenuAnchor, setDiskMenuAnchor] = useState<HTMLElement | null>(null)
const [diskMenuTarget, setDiskMenuTarget] = useState<any | null>(null)
const [detachConfirmOpen, setDetachConfirmOpen] = useState(false)
const [editDiskInitialTab, setEditDiskInitialTab] = useState<number>(0)
```

- [ ] **Step 3: Thread `editDiskInitialTab` down to the EditDiskDialog instance**

This file is a "view" — the `EditDiskDialog` is actually rendered from `InventoryDialogs.tsx`. Since `VmDetailTabs` already owns `setSelectedDisk` / `setEditDiskDialogOpen` via props, extend the props to also carry `setEditDiskInitialTab`.

In `VmDetailTabs.tsx`, find the props interface (search for the first `interface` near the top, likely named `VmDetailTabsProps`). If a local `initialTab` state is possible (i.e., the dialog is rendered inside this component), add it here. Otherwise, add `setEditDiskInitialTab: (v: number) => void` to the props interface and destructure it.

**Inspection step** — before coding the prop drill, run:
```bash
grep -n "EditDiskDialog\|editDiskDialogOpen" /root/saas/proxcenter-frontend/frontend/src/app/\(dashboard\)/infrastructure/inventory/tabs/VmDetailTabs.tsx | head -5
```

If `EditDiskDialog` is not rendered in `VmDetailTabs.tsx` itself (expected — it's in `InventoryDialogs.tsx`), then proceed by adding `setEditDiskInitialTab` to the props interface and destructuring it from `props`. In the kebab menu handlers (Step 5), call `setEditDiskInitialTab(n)` alongside `setEditDiskDialogOpen(true)`.

If `EditDiskDialog` IS rendered locally, keep the state local (no prop drill needed).

- [ ] **Step 4: If prop-drill needed, wire it through `InventoryDialogs.tsx` → `InventoryDetails.tsx`**

In `src/app/(dashboard)/infrastructure/inventory/components/InventoryDialogs.tsx`:
1. Add `editDiskInitialTab: number` to the props interface (near `editDiskDialogOpen`).
2. Destructure it from props.
3. Pass it as `initialTab={editDiskInitialTab}` on the `<EditDiskDialog />` instance (~line 848-855).

In `src/app/(dashboard)/infrastructure/inventory/InventoryDetails.tsx`:
1. Add state: `const [editDiskInitialTab, setEditDiskInitialTab] = useState<number>(0)` near the other disk-dialog state.
2. Pass `editDiskInitialTab={editDiskInitialTab}` to `<InventoryDialogs />` (and `setEditDiskInitialTab` if needed down to `VmDetailTabs`).
3. Pass `setEditDiskInitialTab` through to `<VmDetailTabs />` as the prop added in Step 3.

- [ ] **Step 5: Replace the trailing `ri-pencil-line` on active disk rows with a kebab menu**

Find the line (approx. line 1441):

```tsx
<i className="ri-pencil-line" style={{ fontSize: 16, opacity: 0.5 }} />
```

This icon sits at the end of every `<ListItemButton>` for every disk. Wrap the mapping function so that:
- If `disk.isUnused` → render the two inline icons (Task 7 will do this — leave a `null` placeholder for now, e.g. a comment `{/* unused row icons – Task 7 */}`).
- Otherwise → render the kebab `IconButton` with menu open logic.

Replace the `<i className="ri-pencil-line" ... />` line with:

```tsx
{disk.isUnused ? null : (
  <IconButton
    size="small"
    onClick={(e) => {
      e.stopPropagation()
      setDiskMenuTarget(disk)
      setDiskMenuAnchor(e.currentTarget)
    }}
    aria-label="disk actions"
  >
    <i className="ri-more-2-fill" style={{ fontSize: 18, opacity: 0.6 }} />
  </IconButton>
)}
```

- [ ] **Step 6: Render the Menu and DetachConfirmDialog at the end of the Disks card**

Just after the closing `</Card>` of the Disks card (search for the closing tag after the disk `<List>` / `<Alert severity="info">` block, approx. line 1450), add:

```tsx
<Menu
  anchorEl={diskMenuAnchor}
  open={Boolean(diskMenuAnchor)}
  onClose={() => setDiskMenuAnchor(null)}
>
  <MenuItem
    onClick={() => {
      setDiskMenuAnchor(null)
      if (!diskMenuTarget) return
      setSelectedDisk(diskMenuTarget)
      setEditDiskInitialTab(0)
      setEditDiskDialogOpen(true)
    }}
  >
    <ListItemIcon><i className="ri-pencil-line" style={{ fontSize: 16 }} /></ListItemIcon>
    {t('common.edit')}
  </MenuItem>
  <MenuItem
    onClick={() => {
      setDiskMenuAnchor(null)
      if (!diskMenuTarget) return
      setSelectedDisk(diskMenuTarget)
      setEditDiskInitialTab(2)
      setEditDiskDialogOpen(true)
    }}
  >
    <ListItemIcon><i className="ri-expand-diagonal-line" style={{ fontSize: 16 }} /></ListItemIcon>
    {t('hardware.resize')}
  </MenuItem>
  <MenuItem
    onClick={() => {
      setDiskMenuAnchor(null)
      if (!diskMenuTarget) return
      setSelectedDisk(diskMenuTarget)
      setEditDiskInitialTab(3)
      setEditDiskDialogOpen(true)
    }}
  >
    <ListItemIcon><i className="ri-folder-transfer-line" style={{ fontSize: 16 }} /></ListItemIcon>
    {t('hardware.moveStorage')}
  </MenuItem>
  <Divider />
  <MenuItem
    onClick={() => {
      setDiskMenuAnchor(null)
      if (!diskMenuTarget) return
      setSelectedDisk(diskMenuTarget)
      setDetachConfirmOpen(true)
    }}
    sx={{ color: 'warning.main' }}
  >
    <ListItemIcon><i className="ri-link-unlink" style={{ fontSize: 16, color: 'var(--mui-palette-warning-main)' }} /></ListItemIcon>
    {t('hardware.detach')}
  </MenuItem>
</Menu>
{selectedDisk && (
  <DetachConfirmDialog
    open={detachConfirmOpen}
    diskId={selectedDisk.id}
    onClose={() => setDetachConfirmOpen(false)}
    onConfirm={async () => { await handleDetachDisk() }}
  />
)}
```

The keys `hardware.resize` and `hardware.moveStorage` were added to all 4 locales in Task 1 — no `defaultMessage` fallback needed (per `feedback_always_i18n.md`).

- [ ] **Step 7: Ensure `handleDetachDisk` is accessible in this component**

`VmDetailTabs.tsx` receives handlers via props. Verify with:
```bash
grep -n "handleDetachDisk\|handleDeleteDisk" /root/saas/proxcenter-frontend/frontend/src/app/\(dashboard\)/infrastructure/inventory/tabs/VmDetailTabs.tsx
```

If `handleDetachDisk` is not yet in the props, add it to the props interface and destructure. Trace the prop drill through `InventoryDetails.tsx` to make sure it's passed down — Task 2's rename should have already updated the destructure names; verify by running:
```bash
grep -n "handleDeleteDisk\|handleDetachDisk" /root/saas/proxcenter-frontend/frontend/src/app/\(dashboard\)/infrastructure/inventory/InventoryDetails.tsx
```

Expected: `handleDetachDisk` only.

- [ ] **Step 8: Verify TypeScript compiles**

Run:
```bash
cd /root/saas/proxcenter-frontend/frontend && npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors in `VmDetailTabs.tsx`, `InventoryDialogs.tsx`, `InventoryDetails.tsx`. If errors surface, fix them before committing.

- [ ] **Step 9: Commit**

```bash
cd /root/saas/proxcenter-frontend && git add frontend/src/app && git commit -m "feat(inventory): kebab menu with Detach action on active disk rows"
```

---

## Task 7: Inline Attach + Delete icons on unused disk rows

**Files:**
- Modify: `src/app/(dashboard)/infrastructure/inventory/tabs/VmDetailTabs.tsx`

Replace the placeholder left in Task 6 Step 5 with two `IconButton`s for unused rows: Attach (opens `EditDiskDialog` — its unused variant already contains the reassign UI) and Delete (opens `DeleteUnusedDiskDialog`).

- [ ] **Step 1: Import `DeleteUnusedDiskDialog` in `VmDetailTabs.tsx`**

Add to the imports:

```ts
import { DeleteUnusedDiskDialog } from '@/components/hardware/DeleteUnusedDiskDialog'
```

- [ ] **Step 2: Add state for the delete-unused confirm**

Near the other disk state:

```ts
const [deleteUnusedTarget, setDeleteUnusedTarget] = useState<any | null>(null)
```

- [ ] **Step 3: Replace the `null` placeholder left in Task 6 with the two inline icons**

Find the placeholder `{disk.isUnused ? null : ( ...`  and change the `null` branch to:

```tsx
{disk.isUnused ? (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
    <MuiTooltip title={t('hardware.attach')}>
      <IconButton
        size="small"
        color="primary"
        onClick={(e) => {
          e.stopPropagation()
          setSelectedDisk(disk)
          setEditDiskDialogOpen(true)
        }}
        aria-label={t('hardware.attach')}
      >
        <i className="ri-link" style={{ fontSize: 18 }} />
      </IconButton>
    </MuiTooltip>
    <MuiTooltip title={t('common.delete')}>
      <IconButton
        size="small"
        color="error"
        onClick={(e) => {
          e.stopPropagation()
          setDeleteUnusedTarget(disk)
        }}
        aria-label={t('common.delete')}
      >
        <i className="ri-delete-bin-line" style={{ fontSize: 18 }} />
      </IconButton>
    </MuiTooltip>
  </Box>
) : (
  <IconButton
    size="small"
    onClick={(e) => {
      e.stopPropagation()
      setDiskMenuTarget(disk)
      setDiskMenuAnchor(e.currentTarget)
    }}
    aria-label="disk actions"
  >
    <i className="ri-more-2-fill" style={{ fontSize: 18, opacity: 0.6 }} />
  </IconButton>
)}
```

(`MuiTooltip` is already imported — verify with `grep "MuiTooltip" /root/saas/proxcenter-frontend/frontend/src/app/\(dashboard\)/infrastructure/inventory/tabs/VmDetailTabs.tsx`; if not, add `import { Tooltip as MuiTooltip } from '@mui/material'` or use the existing alias used elsewhere in the file.)

- [ ] **Step 4: Render `DeleteUnusedDiskDialog` at the end of the Disks card**

Just after the `DetachConfirmDialog` rendered in Task 6 Step 6, add:

```tsx
{deleteUnusedTarget && (
  <DeleteUnusedDiskDialog
    open={Boolean(deleteUnusedTarget)}
    diskId={deleteUnusedTarget.id}
    volume={deleteUnusedTarget.rawValue || ''}
    onClose={() => setDeleteUnusedTarget(null)}
    onConfirm={async () => {
      setSelectedDisk(deleteUnusedTarget)
      await handleDetachDisk()
    }}
  />
)}
```

**Note on `handleDetachDisk` for unused**: calling `handleDetachDisk` on an unused disk sends `PUT /config { delete: unusedN }` — PVE destroys the volume because it is no longer referenced. Same handler, correct semantic. See spec §"API payloads".

- [ ] **Step 5: Verify TypeScript compiles**

Run:
```bash
cd /root/saas/proxcenter-frontend/frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
cd /root/saas/proxcenter-frontend && git add frontend/src/app/\(dashboard\)/infrastructure/inventory/tabs/VmDetailTabs.tsx && git commit -m "feat(inventory): inline Attach + Delete icons on unused disk rows"
```

---

## Task 8: Manual verification + re-index GitNexus

**Files:** none to modify. Manual UI testing, per user policy (`feedback_no_build.md` — the user tests themselves, but we can do smoke checks).

- [ ] **Step 1: Run `gitnexus_detect_changes`**

Use `mcp__gitnexus__detect_changes`:
```json
{ "scope": "compare", "base_ref": "main~5" }
```

Expected: only the files listed in the File Map above. If unexpected files appear, investigate before declaring done.

- [ ] **Step 2: Verify final TypeScript check**

Run:
```bash
cd /root/saas/proxcenter-frontend/frontend && npx tsc --noEmit 2>&1 | tail -20
```

Expected: clean exit with no new errors introduced by this feature.

- [ ] **Step 3: Manual verification checklist for the user**

Post this checklist back to the user for them to run against a real PVE cluster. **Do not claim the feature works without this verification**:

1. Open a VM detail view with at least one active disk (scsi/virtio/sata/ide).
2. Confirm the ⋮ kebab appears at the end of each active disk row (not on unused, cdrom, efidisk, tpm rows — wait, check: spec covers CDROM/EFI/TPM as "Active (non-unused)" so they DO get the kebab. If user wants them excluded, file a follow-up.)
3. Click ⋮ → confirm 4 items appear: Edit, Resize, Move storage, Detach.
4. Click Detach → confirm dialog appears (warning color, "Detach disk" title).
5. Confirm → disk moves from active list to unused list without page reload.
6. On the unused disk, confirm two icons appear (Attach = blue link, Delete = red trash).
7. Click Attach → EditDiskDialog opens in unused variant with bus/index form.
8. Choose a different bus (e.g. switched from scsi0 → ide0), click Reassign → disk reappears in active list with new bus.
9. Detach it again, click Delete on the unused row → red confirm dialog → confirm → disk disappears entirely.
10. Verify the PVE config on the node reflects the final state: `cat /etc/pve/nodes/<node>/qemu-server/<vmid>.conf`.
11. Verify i18n: switch UI language to fr, de, zh-CN and confirm all new labels render without any "hardware.xxx" key showing through.

- [ ] **Step 4: Re-index GitNexus**

Run:
```bash
cd /root/saas/proxcenter-frontend && npx gitnexus analyze --embeddings
```

Expected: "Analysis complete" with updated symbol count. Check `.gitnexus/meta.json` for non-zero `stats.embeddings`.

- [ ] **Step 5: Report completion**

Only after the user has confirmed all checklist items pass on their cluster, respond with: "Implementation and verification complete. 7 commits on `main` implementing #259."

---

## Out of Scope — Verified Against Spec

- ✅ LXC excluded (task list does not touch LXC hooks/components)
- ✅ No new backend route (all API calls hit the existing `PUT /config`)
- ✅ Reassign Owner not included
- ✅ No frontend tests (repo has no harness at this layer)
- ✅ CDROM variant of EditDiskDialog left intact (per spec Risks §)
