# Set Display Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to set VM display (VGA) memory (4-512 MB) from ProxCenter, matching the PVE native Hardware → Display panel. Issue [#260](https://github.com/adminsyspro/proxcenter-ui/issues/260).

**Architecture:** Extend the existing generic `editOptionDialog` with a new `'vga'` type that renders a type Select + conditional memory TextField. The full VGA string `"<type>[,memory=<mb>]"` is bound to the existing `editOptionValue` state and flows through the unchanged `handleSaveOption` → `PUT /config` path. No new backend route, no new component file.

**Tech Stack:** Next.js 16 / React 19 / TypeScript 5 / MUI 7 / next-intl JSON messages (`src/messages/{en,fr,de,zh-CN}.json`).

**Branch:** `main` (per prior user direction for issue #259 branch; same policy applies).

**Spec:** [`docs/superpowers/specs/2026-04-20-display-memory-design.md`](../specs/2026-04-20-display-memory-design.md)

---

## File Map

| File | Change | Responsibility |
|---|---|---|
| `src/messages/{en,fr,de,zh-CN}.json` | Modify | Add `inventory.displayMemory`, `inventory.displayMemoryHelper` |
| `src/app/(dashboard)/infrastructure/inventory/components/InventoryDialogs.tsx` | Modify | Widen `editOptionDialog` type union to include `'vga'`; add a new render branch with Select + conditional Memory input; derive/regenerate the `"<type>[,memory=<mb>]"` string bound to `editOptionValue` |
| `src/app/(dashboard)/infrastructure/inventory/tabs/VmDetailTabs.tsx` | Modify | Change the VGA option row from `type: 'select'` to `type: 'vga'`; update the row's `value` to append ` · {n} MB` when memory is present; update `editValue` to pass the full raw VGA string (not `split(',')[0]`) |

No new files. Backend unchanged (`vga` already whitelisted in `/config` PUT route).

---

## Task 1: Add i18n keys

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/fr.json`
- Modify: `src/messages/de.json`
- Modify: `src/messages/zh-CN.json`

Ship i18n first so later tasks can reference real keys (no `defaultMessage` fallback, per `feedback_always_i18n.md`).

- [ ] **Step 1: Locate the `inventory` namespace in each locale file**

Run:
```bash
grep -n '"inventory"' /root/saas/proxcenter-frontend/frontend/src/messages/en.json
```

Expected: a line showing the opening of the `inventory` object. Note the line number.

- [ ] **Step 2: Add 2 new keys inside the `inventory` object of each locale file**

For `en.json`, insert (inside `"inventory": { ... }`, near the existing `display` key if present, otherwise anywhere inside the object):
```json
"displayMemory": "Memory",
"displayMemoryHelper": "4 – 512 MB. Default: 16 MB."
```

For `fr.json`:
```json
"displayMemory": "Mémoire",
"displayMemoryHelper": "4 – 512 MB. Défaut : 16 MB."
```

For `de.json`:
```json
"displayMemory": "Speicher",
"displayMemoryHelper": "4 – 512 MB. Standard: 16 MB."
```

For `zh-CN.json`:
```json
"displayMemory": "显存",
"displayMemoryHelper": "4 – 512 MB。默认：16 MB。"
```

- [ ] **Step 3: Check for pre-existing key collisions**

Run:
```bash
for f in en fr de zh-CN; do \
  grep -E '"displayMemory"|"displayMemoryHelper"' /root/saas/proxcenter-frontend/frontend/src/messages/${f}.json | wc -l; \
done
```

After editing, each file should report **2**. If any file reports a value other than 2, a key was missed or duplicated — fix before continuing.

- [ ] **Step 4: Validate JSON**

Run:
```bash
for f in en fr de zh-CN; do \
  node -e "JSON.parse(require('fs').readFileSync('/root/saas/proxcenter-frontend/frontend/src/messages/${f}.json','utf8'))" \
  && echo "$f OK" || echo "$f FAIL"; \
done
```

Expected: `en OK`, `fr OK`, `de OK`, `zh-CN OK`.

- [ ] **Step 5: Commit**

```bash
cd /root/saas/proxcenter-frontend && git add frontend/src/messages/en.json frontend/src/messages/fr.json frontend/src/messages/de.json frontend/src/messages/zh-CN.json && git commit -m "feat(i18n): add displayMemory keys for VGA memory editor"
```

**Do NOT** add `Co-Authored-By: Claude` to the commit message (user policy).

---

## Task 2: Extend `editOptionDialog` type and add 'vga' render branch

**Files:**
- Modify: `src/app/(dashboard)/infrastructure/inventory/components/InventoryDialogs.tsx` (prop type around line 147; render branch after the existing `hotplug` branch around line 1024)

This task adds the new `'vga'` dialog variant without changing any existing call site — only the union widens. The VGA row in `VmDetailTabs.tsx` will be switched to `'vga'` in Task 3.

- [ ] **Step 1: Widen the `editOptionDialog` prop type**

Find in `InventoryDialogs.tsx` (around line 147):
```ts
editOptionDialog: { key: string; label: string; value: any; type: 'text' | 'boolean' | 'select' | 'hotplug'; options?: { value: string; label: string }[] } | null
```

Change the `type` union to include `'vga'`:
```ts
editOptionDialog: { key: string; label: string; value: any; type: 'text' | 'boolean' | 'select' | 'vga' | 'hotplug'; options?: { value: string; label: string }[] } | null
```

- [ ] **Step 2: Verify TypeScript is still happy after the union widen (no call site forces exhaustiveness yet)**

Run:
```bash
cd /root/saas/proxcenter-frontend/frontend && npx tsc --noEmit 2>&1 | grep -E "editOptionDialog|type.*vga" | head -10 || echo "clean"
```

Expected: `clean`.

- [ ] **Step 3: Locate the render switch**

Inside the `editOptionDialog` JSX (around line 960-1038 in `InventoryDialogs.tsx`), find the `hotplug` branch at line ~1004:

```tsx
{editOptionDialog?.type === 'hotplug' && (() => {
  const fields = ['disk', 'network', 'usb', 'memory', 'cpu']
  // ...
})()}
```

We will add a new sibling branch for `'vga'` right **after** `hotplug` (before the closing `</Box>` on line 1025).

- [ ] **Step 4: Add the `'vga'` render branch**

Insert the following block after the `hotplug` branch's closing `)()}` and before the closing `</Box>` on line ~1025:

```tsx
{editOptionDialog?.type === 'vga' && (() => {
  const MEMORY_CAPABLE = new Set(['std', 'cirrus', 'vmware', 'qxl', 'virtio', 'virtio-gl'])
  const raw = typeof editOptionValue === 'string' ? editOptionValue : ''
  const parts = raw.split(',').map(p => p.trim()).filter(Boolean)
  const vgaType = parts[0] || 'std'
  const memMatch = parts.slice(1).find(p => p.startsWith('memory='))
  const memory = memMatch ? parseInt(memMatch.split('=')[1], 10) : NaN
  const memoryCapable = MEMORY_CAPABLE.has(vgaType)
  const memoryValue = memoryCapable ? (Number.isFinite(memory) ? memory : 16) : undefined

  const buildValue = (nextType: string, nextMemory: number | undefined): string => {
    if (MEMORY_CAPABLE.has(nextType) && typeof nextMemory === 'number' && nextMemory !== 16) {
      return `${nextType},memory=${nextMemory}`
    }
    return nextType
  }

  return (
    <Stack spacing={2}>
      <FormControl fullWidth size="small">
        <InputLabel>{editOptionDialog?.label}</InputLabel>
        <Select
          value={vgaType}
          onChange={(e) => {
            const nextType = String(e.target.value)
            const nextMem = MEMORY_CAPABLE.has(nextType) ? memoryValue ?? 16 : undefined
            setEditOptionValue(buildValue(nextType, nextMem))
          }}
          label={editOptionDialog?.label}
        >
          {(editOptionDialog?.options || []).map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
          ))}
        </Select>
      </FormControl>
      {memoryCapable && (
        <TextField
          fullWidth
          size="small"
          type="number"
          label={t('inventory.displayMemory')}
          helperText={t('inventory.displayMemoryHelper')}
          inputProps={{ min: 4, max: 512, step: 1 }}
          InputProps={{ endAdornment: <InputAdornment position="end">MB</InputAdornment> }}
          value={memoryValue ?? ''}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10)
            if (Number.isFinite(n)) setEditOptionValue(buildValue(vgaType, n))
          }}
          onBlur={(e) => {
            const n = parseInt(e.target.value, 10)
            const clamped = Number.isFinite(n) ? Math.max(4, Math.min(512, n)) : 16
            setEditOptionValue(buildValue(vgaType, clamped))
          }}
        />
      )}
    </Stack>
  )
})()}
```

Notes:
- `InputAdornment` and `Stack` must be imported from `@mui/material`. Check the imports at the top of `InventoryDialogs.tsx` and add any missing ones. A quick grep will reveal which are already present:
  ```bash
  grep -nE "InputAdornment|^import .*Stack.*from '@mui/material'" /root/saas/proxcenter-frontend/frontend/src/app/\(dashboard\)/infrastructure/inventory/components/InventoryDialogs.tsx | head
  ```
  If either is missing, add it to the existing MUI import block.
- The `buildValue` helper intentionally omits `memory=16` (the PVE default) to keep configs clean. If the user picks 16, PVE stores just `vga: std`.

- [ ] **Step 5: Verify imports**

Run:
```bash
grep -nE "^\s*InputAdornment,|^\s*Stack," /root/saas/proxcenter-frontend/frontend/src/app/\(dashboard\)/infrastructure/inventory/components/InventoryDialogs.tsx | head
```

If `InputAdornment` or `Stack` is missing, add it to the `@mui/material` import block near the top of the file.

- [ ] **Step 6: TypeScript check**

```bash
cd /root/saas/proxcenter-frontend/frontend && npx tsc --noEmit 2>&1 | tail -20
```

Expected: no errors on `InventoryDialogs.tsx`. If errors appear, fix them (usually a missing import).

- [ ] **Step 7: Commit**

```bash
cd /root/saas/proxcenter-frontend && git add frontend/src/app/\(dashboard\)/infrastructure/inventory/components/InventoryDialogs.tsx && git commit -m "feat(inventory): add 'vga' type to editOptionDialog with memory input"
```

---

## Task 3: Switch the VGA row to `'vga'` type and surface memory in the read view

**Files:**
- Modify: `src/app/(dashboard)/infrastructure/inventory/tabs/VmDetailTabs.tsx` (VGA row around lines 1822-1845)

Two changes to the VGA config entry in the Options list:
1. `type` changes from `'select'` to `'vga'` so the new editor renders.
2. `value` string includes the memory annotation when `data.systemInfo.vga` contains one.
3. `editValue` stops dropping the memory part so the dialog opens with the actual current value.

- [ ] **Step 1: Read the existing VGA entry**

Confirm the block at `VmDetailTabs.tsx` lines 1822-1845 still matches the shape described in the spec. If it has drifted, report as BLOCKED — the plan was authored against a specific layout.

- [ ] **Step 2: Replace the VGA entry**

Find:
```tsx
{
  key: 'vga',
  icon: 'ri-monitor-line',
  label: t('inventory.display'),
  value: (() => {
    const vga = data.systemInfo.vga || 'std'
    const vgaLabels: Record<string, string> = {
      std: 'Default (std)', cirrus: 'Cirrus Logic', vmware: 'VMware compatible',
      qxl: 'SPICE (qxl)', serial0: 'Serial terminal 0', serial1: 'Serial terminal 1',
      serial2: 'Serial terminal 2', serial3: 'Serial terminal 3',
      virtio: 'VirtIO-GPU', 'virtio-gl': 'VirtIO-GPU (virgl)', none: 'None',
    }
    return vgaLabels[vga.split(',')[0]] || vga
  })(),
  editValue: (data.systemInfo.vga || 'std').split(',')[0],
  options: [
    { value: 'std', label: 'Default (std)' }, { value: 'cirrus', label: 'Cirrus Logic' },
    { value: 'vmware', label: 'VMware compatible' }, { value: 'qxl', label: 'SPICE (qxl)' },
    { value: 'virtio', label: 'VirtIO-GPU' }, { value: 'virtio-gl', label: 'VirtIO-GPU (virgl)' },
    { value: 'serial0', label: 'Serial terminal 0' }, { value: 'serial1', label: 'Serial terminal 1' },
    { value: 'serial2', label: 'Serial terminal 2' }, { value: 'serial3', label: 'Serial terminal 3' },
    { value: 'none', label: 'None' },
  ],
},
```

Replace with:
```tsx
{
  key: 'vga',
  icon: 'ri-monitor-line',
  label: t('inventory.display'),
  type: 'vga',
  value: (() => {
    const vga = data.systemInfo.vga || 'std'
    const vgaLabels: Record<string, string> = {
      std: 'Default (std)', cirrus: 'Cirrus Logic', vmware: 'VMware compatible',
      qxl: 'SPICE (qxl)', serial0: 'Serial terminal 0', serial1: 'Serial terminal 1',
      serial2: 'Serial terminal 2', serial3: 'Serial terminal 3',
      virtio: 'VirtIO-GPU', 'virtio-gl': 'VirtIO-GPU (virgl)', none: 'None',
    }
    const parts = vga.split(',').map((p: string) => p.trim()).filter(Boolean)
    const typeKey = parts[0] || 'std'
    const label = vgaLabels[typeKey] || typeKey
    const memPart = parts.slice(1).find((p: string) => p.startsWith('memory='))
    const mem = memPart ? parseInt(memPart.split('=')[1], 10) : NaN
    return Number.isFinite(mem) ? `${label} · ${mem} MB` : label
  })(),
  editValue: data.systemInfo.vga || 'std',
  options: [
    { value: 'std', label: 'Default (std)' }, { value: 'cirrus', label: 'Cirrus Logic' },
    { value: 'vmware', label: 'VMware compatible' }, { value: 'qxl', label: 'SPICE (qxl)' },
    { value: 'virtio', label: 'VirtIO-GPU' }, { value: 'virtio-gl', label: 'VirtIO-GPU (virgl)' },
    { value: 'serial0', label: 'Serial terminal 0' }, { value: 'serial1', label: 'Serial terminal 1' },
    { value: 'serial2', label: 'Serial terminal 2' }, { value: 'serial3', label: 'Serial terminal 3' },
    { value: 'none', label: 'None' },
  ],
},
```

Three changes vs. the original:
- Added `type: 'vga'`.
- `value` builds the label then appends ` · {n} MB` when a memory is parsed from the raw value.
- `editValue` returns the full raw value instead of `.split(',')[0]`, so the dialog receives the current memory setting.

**Note**: the surrounding options array may assign `type` elsewhere (e.g., some entries have no explicit `type` and default to `'select'`). Check the entry immediately above or below; if `type` is currently implicit for other entries, your added `type: 'vga'` must be the only change to this specific VGA entry — don't touch other entries.

- [ ] **Step 3: TypeScript check**

```bash
cd /root/saas/proxcenter-frontend/frontend && npx tsc --noEmit 2>&1 | tail -20
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
cd /root/saas/proxcenter-frontend && git add frontend/src/app/\(dashboard\)/infrastructure/inventory/tabs/VmDetailTabs.tsx && git commit -m "feat(inventory): wire VGA row to new 'vga' editor; show memory in read view"
```

---

## Task 4: Manual verification checklist + GitNexus re-index

No files to modify. The user will test against a real PVE.

- [ ] **Step 1: Final TypeScript sanity**

```bash
cd /root/saas/proxcenter-frontend/frontend && npx tsc --noEmit 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 2: Manual test checklist (give to user)**

Ask the user to verify on their cluster:

1. Open a VM → Options tab → click the **Display** row.
2. Dialog opens showing the current VGA type AND a Memory field (in MB) when the type is `std / cirrus / vmware / qxl / virtio / virtio-gl`.
3. Change type to `serial0` → memory field disappears. Change back to `std` → memory field reappears pre-filled with 16 MB.
4. Type an invalid memory (e.g. `9999`) → on blur, clamped to 512.
5. Save with `std` + `32 MB` → PVE config should have `vga: std,memory=32`. Verify with:
   ```bash
   grep ^vga /etc/pve/nodes/<NODE>/qemu-server/<VMID>.conf
   ```
6. Set memory back to 16 → save. PVE config should have just `vga: std` (no `memory=` line) because 16 is the default.
7. Pick `none` and save → PVE config: `vga: none`. No memory param persisted.
8. Read view (Options list) shows `"Default (std) · 32 MB"` when memory is set, `"Default (std)"` otherwise.
9. Switch UI language to fr / de / zh-CN → all new labels render correctly (no raw `inventory.displayMemory` string leaks through).

- [ ] **Step 3: Re-index GitNexus**

```bash
cd /root/saas/proxcenter-frontend && npx gitnexus analyze --embeddings
```

Expected: "Analysis complete". Verify `.gitnexus/meta.json` shows an updated symbol count.

- [ ] **Step 4: Report back to user**

Once manual verification passes, state: "Feature #260 implemented in 3 commits on `main`. Ready for release."

---

## Self-Review

- **Spec coverage:**
  - UI with type Select + conditional Memory input → Task 2 ✓
  - Memory hidden for serial/none → Task 2 (`MEMORY_CAPABLE` gate) ✓
  - Default 16 MB → Task 2 (`memoryValue ?? 16`) ✓
  - Save string `"<type>,memory=<mb>"` (omit memory when default) → Task 2 (`buildValue`) ✓
  - Read view appends ` · {n} MB` → Task 3 ✓
  - `editValue` restores memory on open → Task 3 (removed `.split(',')[0]`) ✓
  - i18n in 4 locales → Task 1 ✓
  - Clamp memory [4, 512] on blur → Task 2 ✓
- **No placeholders**: all code blocks contain actual code; all verification commands have expected outputs.
- **Type consistency**: `editOptionDialog.type` union is widened once in Task 2 and consumed in Task 3. `editOptionValue` stays `string | number | any` (existing type, unchanged). `MEMORY_CAPABLE` is an internal constant, not cross-referenced.
