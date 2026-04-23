# SSH Commands — Settings Tab

**Date**: 2026-04-23
**Area**: `/settings?tab=ssh-commands` — transparency + security recommendations for the SSH command allowlist
**Scope**: single feature across `proxcenter-frontend` + `proxcenter-backend`
**Triggering issue**: [adminsyspro/proxcenter-ui#267](https://github.com/adminsyspro/proxcenter-ui/issues/267) — the reporter explicitly asked for "a comprehensive list of all the sudo commands required to run Proxcenter in the documentation".

## 1. Problem

Two related gaps today:

1. **No visibility on what ProxCenter runs over SSH.** Administrators who want to switch from `root` to a dedicated non-privileged user with `sudo` have no canonical list of the commands that must be authorised. They have to dig into the Go source code (`proxcenter-backend/internal/api/ssh.go:347`) to discover the prefixes.
2. **No in-product guidance on SSH security posture.** Many customers run ProxCenter with a bare `root` SSH connection because the product provides no recommendation or tooling to migrate to a scoped user. No best practice is documented in the UI.

This spec introduces a read-only **SSH Commands** tab in `/settings` that answers both needs: it shows the current allowlist grouped by purpose, surfaces the customer's current SSH posture, and gives a pragmatic recommendation + copy-paste sudoers template to make the migration trivial.

## 2. Non-goals (MVP)

- Editing the allowlist from the UI (read-only). Adding/removing prefixes remains a backend code change.
- Per-tenant or per-connection custom allowlists.
- Runtime enforcement hardening. Today the allowlist is only checked by the Go orchestrator handler (`handleSSHExec`); the frontend's `executeSSHDirect` and the `sudo sh -c '...'` wrapping both bypass it. **This spec does NOT fix that**, it is tracked separately as a security-hardening task (see §8).
- Export of the allowlist (CSV, JSON download). Copy-to-clipboard of the sudoers template is enough for MVP.
- Syslog / audit log integration (tracked in project_syslog_integration).

## 3. Decisions summary

| # | Decision |
|---|---|
| 1 | New main tab in `/settings` labelled **SSH Commands**, icon `ri-terminal-line`, URL `/settings?tab=ssh-commands` |
| 2 | Visible to any user with `CONNECTION_VIEW` permission, no license feature gate |
| 3 | Backend becomes the single source of truth: `GET /api/v1/ssh/allowlist` returns the structured allowlist |
| 4 | Go allowlist refactored from `[]string` to `[]AllowedCommand` (prefix, category, description, usedBy) without changing the matching behaviour of `handleSSHExec` |
| 5 | Page layout: 3 cards — Connection status, Security recommendations, Command allowlist |
| 6 | Sudoers template is generated client-side from the allowlist JSON and copied to clipboard on click |
| 7 | Honest disclaimer surfaced under the recommendations card: "the allowlist is enforced when commands route through the orchestrator; broader enforcement is tracked separately" |
| 8 | i18n in all four locales (en / fr / de / zh-CN), no `defaultMessage` fallback |

## 4. Architecture

### 4.1 File layout

**Backend** (`/root/saas/proxcenter-backend/internal/api`)

```
ssh.go
├── type AllowedCommand struct { Prefix, Category, Description, UsedBy }  (NEW)
├── allowedCommands []AllowedCommand                                       (REPLACES allowedPrefixes []string)
├── handleSSHExec()                                                        (loops over allowedCommands[*].Prefix — unchanged behaviour)
├── handleSSHAllowlist() (NEW)                                             (GET /api/v1/ssh/allowlist → JSON groupé par Category)
└── RegisterSSHRoutes()                                                    (+r.Get("/ssh/allowlist", …))
```

```
ssh_test.go  (NEW or extended)
└── Test: every prefix from the legacy []string list is present in []AllowedCommand (non-regression)
└── Test: handleSSHAllowlist returns the expected shape and categories
```

**Frontend** (`/root/saas/proxcenter-frontend/frontend/src`)

```
components/settings/
└── SshCommandsTab.jsx                    (NEW — main tab component, dynamic() import)
    ├── ConnectionStatusCard.jsx          (NEW — "3 PVE, 2 root, 1 sudo" summary)
    ├── SecurityRecommendationsCard.jsx   (NEW — 3 accordion steps + honest disclaimer)
    │   └── SudoersTemplate.jsx           (NEW — generates text from allowlist, Copy button)
    └── AllowlistCard.jsx                 (NEW — search + accordion per category)

app/(dashboard)/settings/page.jsx         (MODIFIED — add SshCommandsTab to allTabs, tab name 'ssh-commands')

messages/en.json                          (MODIFIED — new keys under settings.sshCommands.*)
messages/fr.json                          (MODIFIED — same keys, translated)
messages/de.json                          (MODIFIED — same keys, translated)
messages/zh-CN.json                       (MODIFIED — same keys, translated)
```

### 4.2 Data flow

```
Browser                                  Next.js (frontend)               Go orchestrator
────────                                 ─────────────────                ────────────────
SshCommandsTab mount
  └─ SWR GET /api/v1/ssh/allowlist  ───► passthrough proxy               ─► GET /api/v1/ssh/allowlist
                                                                             └─ returns {categories: [{id, label, commands: [{prefix, description, usedBy}]}]}
  └─ SWR GET /api/v1/connections    ───► existing Next.js route — no change

Click "Copy sudoers template"
  └─ buildSudoersTemplate(allowlist)     (pure client-side fn)
  └─ navigator.clipboard.writeText(…)
```

### 4.3 Category taxonomy

The current `allowedPrefixes` list in `ssh.go` has informal section comments (`// VM/container management`, `// HA maintenance`, `// Migration …`). Those become explicit categories:

| Category id | Label (en) | Example prefixes |
|---|---|---|
| `node-management` | Node & VM management | `qm`, `pct`, `ha-manager`, `nohup bash`, `cat /tmp/.proxcenter-upgrade-status` |
| `migration-esxi` | Migration — VMware ESXi | `export SSHPASS=`, `sshpass`, `ssh -i` (to ESXi) |
| `migration-vcenter-v2v` | Migration — vCenter (virt-v2v) | `virt-v2v`, `apt-get`, `pv`, `printf`, `df`, `find /mnt/hyperv`, `test -f /usr/share/virtio-win`, v2v cleanup regex |
| `migration-xcpng` | Migration — XCP-ng | (same curl/qemu-img family, marked by usedBy) |
| `migration-hyperv` | Migration — Hyper-V | `mount -t cifs`, `umount /mnt/hyperv`, `mountpoint` |
| `migration-common` | Migration — Disk import & conversion | `curl`, `qemu-img`, `timeout`, `rm -f /tmp/`, `pvesm`, `rbd map`, `rbd unmap`, `cat`, `stat`, `tail`, `mkdir -p` |
| `migration-sshfs` | Migration — SSHFS boot path | `ssh-keygen`, `aa-complain`, `aa-enforce`, `apparmor_parser`, `modprobe`, `qemu-nbd`, `fuser`, `chmod`, `fusermount`, `grep -q`, `sed -i` |
| `network-flows` | Network Flows (sFlow / OVS) | `ovs-vsctl`, `ovs-ofctl`, `ip -o link`, `ip link`, `for br in $(ovs-vsctl list-br)` |
| `preflight` | Preflight checks | `echo`, `which`, `test -f`, `test -S`, `ls` |

Every prefix currently in `allowedPrefixes` MUST map to exactly one category (enforced by the non-regression test).

### 4.4 Endpoint contract

**Request**: `GET /api/v1/ssh/allowlist`

**Response** (200, JSON):

```json
{
  "categories": [
    {
      "id": "network-flows",
      "label": "Network Flows (sFlow / OVS)",
      "description": "Queries and configures Open vSwitch agents for sFlow collection.",
      "commands": [
        {
          "prefix": "ovs-vsctl ",
          "description": "Query / configure Open vSwitch bridges and sFlow agents.",
          "usedBy": "Network Flows (Operations → Network Flows)"
        },
        {
          "prefix": "ip -o link",
          "description": "List interfaces with SNMP ifIndex for sFlow port mapping.",
          "usedBy": "Network Flows port mapping"
        }
      ]
    }
  ]
}
```

- Alphabetical sort by category `id`, except `node-management` and `preflight` pinned at the end (cosmetic, less exciting for the reader).
- No secrets in `description` or `usedBy`.
- Stable category ids — the frontend may use them for icon choice.

### 4.5 Sudoers template generation

Client-side only. Takes the allowlist response and produces something like:

```
# /etc/sudoers.d/proxcenter
# Generated by ProxCenter — see /settings?tab=ssh-commands for source
Defaults:proxcenter !requiretty

# Node & VM management
proxcenter ALL=(ALL) NOPASSWD: /usr/bin/qm, /usr/bin/pct, /usr/sbin/ha-manager

# Network Flows (sFlow / OVS)
proxcenter ALL=(ALL) NOPASSWD: /usr/bin/ovs-vsctl, /usr/bin/ovs-ofctl, /sbin/ip

# … (other categories …)
```

A hand-maintained mapping `prefix → absolute path` is needed (e.g. `qm` → `/usr/bin/qm`). This mapping lives in the frontend (`SudoersTemplate.jsx`) and is the only place where absolute paths are known. This is pragmatic: the Go allowlist uses prefixes that may contain shell constructs (`for br in $(…)`) which cannot be translated to sudoers as-is. The template covers the **simple exec** cases (the majority) and calls out in a comment that a few shell-wrapped commands (notably the `for br in $(ovs-vsctl list-br)` loop) are not covered by the template and require a more permissive rule (e.g. `NOPASSWD: /bin/sh`) — **which we flag with a warning in the UI**.

### 4.6 Connection status card

Fetches `/api/v1/connections` (existing route), filters `type=pve`, aggregates:

```
{
  total: 4,
  root: 3,
  nonRootWithSudo: 1,
  nonRootWithoutSudo: 0
}
```

Rendered as a one-line factual summary plus a coloured chip:

- All `root` → warning chip "Consider using a dedicated user with sudo"
- Mixed → info chip "Partially hardened"
- All `nonRoot + sudo` → success chip "Hardened"

Clicking the chip scrolls to the recommendations card.

### 4.7 Security recommendations card

Header: one short paragraph (pragmatic, non-dogmatic — see §5 of this design for the exact wording in English; translations follow the same tone).

Three accordion steps, each collapsed by default:

1. **Create a dedicated SSH user on each PVE node** — copyable bash block:
   ```bash
   adduser --system --shell /bin/bash --group proxcenter
   mkdir -p /home/proxcenter/.ssh
   echo "ssh-ed25519 AAAA… proxcenter@…" >> /home/proxcenter/.ssh/authorized_keys
   chown -R proxcenter:proxcenter /home/proxcenter/.ssh
   chmod 700 /home/proxcenter/.ssh
   chmod 600 /home/proxcenter/.ssh/authorized_keys
   usermod -aG openvswitch proxcenter    # needed for Network Flows
   ```

2. **Install the sudoers template** — two copy buttons:
   - *Copy sudoers template* (filled from the allowlist)
   - *Install command* (`echo '<contents>' | sudo tee /etc/sudoers.d/proxcenter && sudo visudo -c`)

3. **Switch the ProxCenter connection to the new user** — 3 numbered UI steps with inline screenshots or an animated caret pointing at the right field in the Connections tab:
   - Open /settings → Connections → PVE → select connection → Edit
   - Change SSH user to `proxcenter`
   - Enable toggle **Use sudo**
   - Save and test

Below the three steps, in a muted info callout, the honest disclaimer:

> Note: the command allowlist is applied when commands route through the embedded orchestrator. Some code paths (migrations, direct node operations) bypass this check today. A security-hardening task is tracked to extend strict enforcement; running ProxCenter under a dedicated user with sudo already provides OS-level audit trail (`/var/log/auth.log`) and scopes compromise impact.

### 4.8 Allowlist card

- Search input at the top — filters commands whose `prefix`, `description`, or `usedBy` contains the query (case-insensitive). When a query is active, accordions that have no matching command are hidden.
- One accordion per category. Header shows icon + label + count chip. Open by default only if there is an active search query that matches inside.
- Body: MUI `Table` with three columns — `Prefix`, `Purpose`, `Used by`. No row actions, no sort — the list is short enough to read linearly inside a category.
- Empty state (no category, e.g. endpoint failure): a simple error block with "Retry" button.

## 5. UX copy (English master)

All keys live under `settings.sshCommands.*`. Examples:

| Key | Text |
|---|---|
| `tabLabel` | "SSH Commands" |
| `page.title` | "SSH commands executed on your nodes" |
| `page.subtitle` | "Full list of commands ProxCenter runs over SSH, grouped by purpose, with a sudoers template to run as a dedicated user." |
| `status.heading` | "Your PVE connections" |
| `status.rootWarning` | "All connections use `root`. Consider switching to a dedicated user with `sudo` for audit trails and reduced compromise scope." |
| `status.partial` | "Partially hardened: some connections still use `root`." |
| `status.hardened` | "Hardened: all connections use a dedicated user with `sudo`." |
| `recs.heading` | "Security recommendations" |
| `recs.intro` | "For lab or single-admin setups, `root` is acceptable if SSH keys are properly managed. For production, multi-admin, or compliance-sensitive environments, a dedicated user with `sudo` is recommended: you get an audit trail in `/var/log/auth.log` and compromise is scoped to the whitelisted commands." |
| `recs.step1` | "Create a dedicated SSH user on each PVE node" |
| `recs.step2` | "Install the sudoers template" |
| `recs.step3` | "Switch the ProxCenter connection to the new user" |
| `recs.copyTemplate` | "Copy sudoers template" |
| `recs.copyInstall` | "Copy install command" |
| `recs.disclaimer` | (honest disclaimer, §4.7) |
| `recs.shellWrapWarning` | "A few commands use shell constructs (e.g. for-loops over OVS bridges) that cannot be expressed as sudoers exec rules. The template includes a scoped `/bin/sh` entry for these; if you want to avoid it, do not use the Network Flows sFlow configuration feature." |
| `allowlist.heading` | "Command allowlist" |
| `allowlist.searchPlaceholder` | "Filter commands…" |
| `allowlist.column.prefix` | "Command" |
| `allowlist.column.purpose` | "Purpose" |
| `allowlist.column.usedBy` | "Used by" |
| `allowlist.noResults` | "No command matches your search." |
| `errors.fetchFailed` | "Failed to load the SSH command list." |
| `errors.clipboardFailed` | "Could not copy to clipboard." |

French, German, Chinese translations follow the same tone (factual, pragmatic, not alarmist).

## 6. Testing

- **Backend (Go)**: one table-driven test in `ssh_test.go` that iterates over the historical (hard-coded) `[]string` whitelist and asserts every entry is present as a `Prefix` in the new `[]AllowedCommand` — guards against accidental removal during refactor. Plus one test that calls `handleSSHAllowlist` and checks the JSON shape (at least 1 category, no empty `Prefix`, no duplicates).
- **Backend (Go)**: one test that exercises `handleSSHExec` with a representative command from each category to confirm the matcher still accepts them (covers the refactor from `[]string` to `[]AllowedCommand`).
- **Frontend**: manual user test (per repo convention — `feedback_no_build.md`).

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Refactor silently drops an allowed prefix → features regress | Non-regression test driven from the historical list (§6) |
| Sudoers template promises too much — users assume full hardening | Explicit disclaimer in UI and in the generated template header comment |
| `/bin/sh` rule scares security-conscious customers | Clear `shellWrapWarning` + opt-out note ("do not use the sFlow config feature") |
| Customer copies the template and switches to non-root without reconnecting the SSH session → OVS group membership not applied | Step 3 of recommendations explicitly says "reconnect after group change"; bash block includes a reminder comment |
| Non-privileged user still hits permission denied on OVS socket even with sudo | Already mitigated: `usermod -aG openvswitch` is in the bash block in §4.7 step 1 |

## 8. Follow-ups (separate tickets)

1. **Harden the orchestrator whitelist matching for `sudo sh -c '...'` commands.** Today the `strings.TrimPrefix(cmdToCheck, "sudo ")` only strips `sudo `, so `sudo sh -c '<escaped>'` never matches and always falls back to the ssh2 direct path. Proposed fix: also strip `sh -c '<quoted>'` wrapper and match against the inner command.
2. **Make `executeSSHDirect` a private helper.** Expose only `executeSSH(connectionId, ip, cmd)` to route handlers; migrations and other direct users should be migrated one by one. This removes the allowlist bypass for everything except the SSH test flow (which is allowed to be unconstrained because it validates connectivity itself).
3. **Generate the sudoers `prefix → absolute path` map from a Go-side table** so the frontend stops carrying path knowledge.
