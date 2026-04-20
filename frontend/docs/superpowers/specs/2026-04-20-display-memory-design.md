# Set Display Memory — Design Spec

**Date**: 2026-04-20
**Scope**: ProxCenter frontend (`proxcenter-frontend/frontend`)
**Status**: Approved for implementation
**Issue**: [#260 — Set Display memory](https://github.com/adminsyspro/proxcenter-ui/issues/260)

## Goal

Expose the VGA memory parameter in the VM Options → Display row so users can set display memory without leaving ProxCenter for the PVE web UI. Mirrors the PVE native Hardware → Display panel.

Applies to QEMU VMs only.

## Non-Goals

- No changes to the rest of the Options editor pattern.
- No standalone `EditDisplayDialog` component — the editor is kept inside the existing `editOptionDialog` for consistency.
- No LXC changes (no `vga` on containers).

## Background / Current State

1. VGA is currently editable as a `select` type in `editOptionDialog` (see `VmDetailTabs.tsx` lines 1822-1845). Options cover `std`, `cirrus`, `vmware`, `qxl`, `virtio`, `virtio-gl`, `serial0..3`, `none`.
2. The editor drops the `memory=` parameter on read:
   - `editValue: (data.systemInfo.vga || 'std').split(',')[0]`
3. On save, `handleSaveOption` (`InventoryDetails.tsx:547-585`) PUTs `{vga: editOptionValue}` directly — a plain string. If `editOptionValue` were `std,memory=16`, it would be preserved end-to-end. The parser and save path are already compatible; only the UI is missing the memory field.
4. PVE accepts `vga: <type>[,memory=<mb>]` where `memory` is 4-512 MB. The parameter is meaningful only for real framebuffer devices: `std`, `cirrus`, `vmware`, `qxl`, `virtio`, `virtio-gl`. Serial and `none` don't use memory.

## Design

### UI

Introduce a new `type: 'vga'` case in the `editOptionDialog` render switch (`InventoryDialogs.tsx` around lines 990-1024, alongside `select` / `boolean` / `hotplug`). The new case renders:

- **Type selector** (`Select`) — same 11 VGA options as today. Width: full.
- **Memory input** (`TextField` `type="number"`, min 4, max 512, step 1, unit suffix "MB"), rendered only when the selected type is one of `std | cirrus | vmware | qxl | virtio | virtio-gl`. Hidden for `serial*` and `none`.

Both fields bind to a single `editOptionValue` **string** in the shape `"<type>"` or `"<type>,memory=<mb>"`. The handler parses and regenerates that string on each change.

Default memory when switching to a memory-capable type from one that isn't (or when no memory was previously set): **16 MB** (PVE's default).

### Display row (read-only view)

In `VmDetailTabs.tsx`, update the Display row so the summary text includes the memory when present:

- Old: `"Default (std)"`
- New: `"Default (std) · 16 MB"` (only the memory suffix when a `memory=<n>` param exists on `systemInfo.vga`)

The `value` field computation extracts `memory=` from `data.systemInfo.vga` and appends ` · {n} MB` when found. The `editValue` field changes to return the full raw value (not `.split(',')[0]`) so the dialog can restore the memory on open.

### Registration as type 'vga'

Change the `type: 'select'` entry on line 1823 (VGA) to `type: 'vga'`. Keep `options` untouched (reused as the select's option list). No other Options rows are affected — they still use `select`/`text`/`boolean`/`hotplug`.

### API

No backend changes. `handleSaveOption` already forwards `{vga: editOptionValue}` verbatim. The `/config` PUT route already whitelists `vga` (`route.ts` line 29). PVE parses the string.

### i18n

Two new keys under `inventory.*` (or `common.*` if fitting) in en/fr/de/zh-CN:

| Key | EN |
|---|---|
| `inventory.displayMemory` | Memory |
| `inventory.displayMemoryHelper` | 4 – 512 MB. Default: 16 MB. |

### Validation

- Memory field coerces to integer, clamped to [4, 512]. Out-of-range values are clamped on blur, not on keypress, so users can type freely.
- If the user picks a non-memory type (serial, none), the memory field disappears and any previously-typed memory is dropped from the saved string.

## File Change List

| File | Change |
|---|---|
| `src/app/(dashboard)/infrastructure/inventory/components/InventoryDialogs.tsx` | Add `type: 'vga'` render branch with type Select + memory TextField (conditional). Helper: parse/regenerate the `"<type>,memory=<mb>"` string. |
| `src/app/(dashboard)/infrastructure/inventory/tabs/VmDetailTabs.tsx` | Change VGA row's `type` from `'select'` to `'vga'`; update `value` string to append ` · {n} MB` when present; update `editValue` to pass the full raw VGA value (not just the type). |
| `src/app/(dashboard)/infrastructure/inventory/components/InventoryDialogs.tsx` (prop type) | Extend the `editOptionDialog` prop type union to include `'vga'`. |
| `src/messages/{en,fr,de,zh-CN}.json` | Add `inventory.displayMemory` and `inventory.displayMemoryHelper`. |

## Risks

- **Existing VMs with custom memory values**: if a VM already has `vga: qxl,memory=32`, opening the editor must show 32 (not 16). The read path fix (passing the full raw value to `editValue`) covers this.
- **Empty `vga` config key**: on VMs where `vga` is unset, PVE defaults to `std`. Our UI already falls back to `'std'`. Unchanged behavior.
- **PVE clamp vs. UI clamp**: we clamp to [4, 512] client-side; PVE would also reject out-of-range values. No drift.
- **`alert()` on save error** (pre-existing, line 581 of `InventoryDetails.tsx`): violates `feedback_modals_mui.md`. Out of scope for this issue; worth a follow-up but not addressed here.

## Out of Scope

- No refactor of `handleSaveOption` or of the generic `editOptionDialog`. We add one branch; the surrounding machinery is unchanged.
- No LXC display settings.
- No SPICE / audio / USB redirection settings (separate PVE concerns).
- No preset "Recommended memory" hints per type.
