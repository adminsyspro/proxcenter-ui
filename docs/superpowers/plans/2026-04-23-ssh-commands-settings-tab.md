# SSH Commands Settings Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Repository policy:** This project requires explicit user approval for git commits (`feedback_no_autocommit`). The "commit" steps below are intentional TDD checkpoints — the executor MUST pause at each commit step and request approval before running it, rather than auto-committing.

**Goal:** Ship a read-only "SSH Commands" tab at `/settings?tab=ssh-commands` that lists every command ProxCenter runs over SSH, shows current SSH posture of the user's PVE connections, and generates a sudoers template to help migrate from `root` to a dedicated non-privileged user.

**Architecture:** Go orchestrator is the single source of truth — `allowedPrefixes` (a `[]string` today) becomes a `[]AllowedCommand` struct carrying `{prefix, category, description, usedBy}`. A new `GET /api/v1/ssh/allowlist` endpoint serves it as JSON. The Next.js frontend proxies this through `/api/v1/ssh/allowlist/route.ts`, and a new `SshCommandsTab.jsx` component renders three cards (connection status, security recommendations, allowlist browser). Sudoers template generation is pure client-side from the allowlist JSON.

**Tech Stack:**
- Backend: Go 1.22, `chi/v5` router, `encoding/json`, stdlib `testing` (no testify — follow existing repo pattern in `internal/replication/*_test.go`)
- Frontend: Next.js 16 app router, React 19, MUI 7, SWR, `next-intl`, Tailwind 4
- Locale files: `src/messages/{en,fr,de,zh-CN}.json` under `settings.sshCommands.*`

**Spec reference:** `docs/superpowers/specs/2026-04-23-ssh-commands-settings-tab-design.md`

**Key file paths (absolute roots):**
- Backend repo: `/root/saas/proxcenter-backend`
- Frontend repo: `/root/saas/proxcenter-frontend`
- Frontend app root: `/root/saas/proxcenter-frontend/frontend`

---

## Task 1: Refactor Go allowlist from `[]string` to `[]AllowedCommand`

**Why first:** every downstream task needs the new structure. We preserve the exact matching semantics of `handleSSHExec` so zero feature regresses, and pin that guarantee with a table-driven non-regression test that iterates over the historical prefix list.

**Files:**
- Create: `/root/saas/proxcenter-backend/internal/api/ssh_allowlist.go`
- Modify: `/root/saas/proxcenter-backend/internal/api/ssh.go:340-395` (remove the inline `allowedPrefixes` literal, call into the new package-level var)
- Test: `/root/saas/proxcenter-backend/internal/api/ssh_allowlist_test.go`

- [ ] **Step 1: Snapshot current behaviour — copy the historical prefix list verbatim into the test file**

Create `/root/saas/proxcenter-backend/internal/api/ssh_allowlist_test.go`:

```go
package api

import (
	"testing"
)

// historicalPrefixes is the frozen snapshot of the []string allowlist as it
// existed before the refactor to []AllowedCommand. This list MUST stay in sync
// with any intentional allowlist change: adding a prefix means adding it here
// AND in allowedCommands. Removing one means removing it from both. The test
// below verifies every prefix in this snapshot still matches at least one
// entry in allowedCommands — if a prefix disappears by accident, this test
// fails and the refactor is reverted.
var historicalPrefixes = []string{
	// VM/container management
	"qm unlock", "pct unlock", "qm status", "pct status",
	"qm create", "qm set", "qm disk import", "qm start", "qm monitor ",
	// HA maintenance
	"ha-manager crm-command node-maintenance",
	// Node upgrade & reboot
	"nohup bash",
	// Upgrade status polling
	"cat /tmp/.proxcenter-upgrade-status",
	// Migration: connectivity test, disk download, conversion, cleanup
	"echo ", "curl ", "qemu-img ", "timeout ", "rm -f /tmp/",
	// Migration: progress polling, stats, which
	"which ",
	// Migration: block storage streaming
	"pvesm ", "rbd map ", "rbd unmap ",
	// Migration: file operations on temp/storage paths
	"cat \"", "cat '", "stat -c %s \"", "stat -c '%s' '", "rm -f \"", "rm -f /tmp/", "tail -c ", "cat > \"",
	"mkdir -p ",
	// Migration: nested SSH to ESXi
	"export SSHPASS=",
	// Migration SSHFS: fuse config, mount/unmount, file verification
	"grep -q ", "sed -i ",
	"fusermount ",
	"test -f ", "test -S ",
	"ls \"", "ls -1 '",
	// Migration SSHFS Boot
	"ssh-keygen ", "ssh -i ",
	"aa-complain ", "aa-enforce ", "apparmor_parser ",
	"modprobe ", "qemu-nbd ", "fuser ",
	"chmod ",
	// Migration virt-v2v
	"virt-v2v ", "apt-get ", "pv ", "printf ", "df ",
	// Migration virt-v2v: scan disks on hyperv mount
	"find /mnt/hyperv ",
	// Migration Hyper-V
	"mount -t cifs ", "umount /mnt/hyperv", "mountpoint ",
	// Migration virt-v2v: test virtio-win
	"test -f /usr/share/virtio-win",
	// Network Flows (sFlow)
	"ovs-vsctl ", "ovs-ofctl ", "ip -o link", "ip link",
	// Network Flows sFlow config per-bridge loop
	"for br in $(ovs-vsctl list-br)",
}

// TestAllowlistNonRegression fails if any historically-allowed prefix is
// missing from the new structured allowedCommands slice.
func TestAllowlistNonRegression(t *testing.T) {
	for _, p := range historicalPrefixes {
		found := false
		for _, ac := range allowedCommands {
			if ac.Prefix == p {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("prefix %q present in historical allowlist but missing from allowedCommands", p)
		}
	}
}

// TestAllowlistNoDuplicatePrefixes catches typos during edits.
func TestAllowlistNoDuplicatePrefixes(t *testing.T) {
	seen := map[string]bool{}
	for _, ac := range allowedCommands {
		if seen[ac.Prefix] {
			t.Errorf("duplicate prefix %q in allowedCommands", ac.Prefix)
		}
		seen[ac.Prefix] = true
	}
}

// TestAllowlistAllCommandsHaveMetadata guards UI quality: every entry must
// have a non-empty Category, Description and UsedBy — otherwise the settings
// page will show blank cells.
func TestAllowlistAllCommandsHaveMetadata(t *testing.T) {
	for _, ac := range allowedCommands {
		if ac.Category == "" {
			t.Errorf("prefix %q has empty Category", ac.Prefix)
		}
		if ac.Description == "" {
			t.Errorf("prefix %q has empty Description", ac.Prefix)
		}
		if ac.UsedBy == "" {
			t.Errorf("prefix %q has empty UsedBy", ac.Prefix)
		}
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `/root/saas/proxcenter-backend`:
```bash
go test ./internal/api/... -run TestAllowlist -v
```
Expected: FAIL with "undefined: allowedCommands" (the symbol doesn't exist yet).

- [ ] **Step 3: Create the structured allowlist**

Create `/root/saas/proxcenter-backend/internal/api/ssh_allowlist.go`:

```go
package api

// AllowedCommand describes one SSH command prefix that the orchestrator
// allows clients to execute. The Prefix is matched with strings.HasPrefix
// (same semantics as the legacy []string allowlist). Category/Description/
// UsedBy are metadata consumed by the /settings?tab=ssh-commands UI.
type AllowedCommand struct {
	Prefix      string `json:"prefix"`
	Category    string `json:"category"`
	Description string `json:"description"`
	UsedBy      string `json:"usedBy"`
}

// AllowlistCategory is a grouping of AllowedCommand used by the GET
// /api/v1/ssh/allowlist endpoint.
type AllowlistCategory struct {
	ID          string           `json:"id"`
	Label       string           `json:"label"`
	Description string           `json:"description"`
	Commands    []AllowedCommand `json:"commands"`
}

// allowedCommands is the single source of truth for what the orchestrator
// permits. handleSSHExec matches by Prefix; handleSSHAllowlist groups and
// serves the full list.
//
// Adding a prefix here MUST be mirrored in historicalPrefixes in the test
// file (or the entry would be a new capability requiring an intentional
// update to the test — never remove an entry from historicalPrefixes
// without explicit review).
var allowedCommands = []AllowedCommand{
	// -------- node-management --------
	{Prefix: "qm unlock", Category: "node-management", Description: "Release a stuck VM configuration lock.", UsedBy: "Operations > VM actions > Unlock"},
	{Prefix: "pct unlock", Category: "node-management", Description: "Release a stuck container configuration lock.", UsedBy: "Operations > CT actions > Unlock"},
	{Prefix: "qm status", Category: "node-management", Description: "Query a VM runtime status.", UsedBy: "Unlock / upgrade preflight"},
	{Prefix: "pct status", Category: "node-management", Description: "Query a container runtime status.", UsedBy: "Unlock / upgrade preflight"},
	{Prefix: "qm create", Category: "node-management", Description: "Create a new VM shell during a migration.", UsedBy: "Migration pipelines"},
	{Prefix: "qm set", Category: "node-management", Description: "Set VM configuration values.", UsedBy: "Migration pipelines"},
	{Prefix: "qm disk import", Category: "node-management", Description: "Import a disk image into a VM.", UsedBy: "Migration pipelines"},
	{Prefix: "qm start", Category: "node-management", Description: "Start a VM.", UsedBy: "Migration finalisation"},
	{Prefix: "qm monitor ", Category: "node-management", Description: "Send a QEMU monitor command to a VM.", UsedBy: "Migration pipelines"},
	{Prefix: "ha-manager crm-command node-maintenance", Category: "node-management", Description: "Toggle HA node maintenance mode.", UsedBy: "Infrastructure > Node > Maintenance"},
	{Prefix: "nohup bash", Category: "node-management", Description: "Run the node upgrade/reboot script in the background.", UsedBy: "Infrastructure > Node > Upgrade"},
	{Prefix: "cat /tmp/.proxcenter-upgrade-status", Category: "node-management", Description: "Poll the node upgrade status file.", UsedBy: "Infrastructure > Node > Upgrade"},

	// -------- migration-common --------
	{Prefix: "echo ", Category: "migration-common", Description: "Connectivity probes and marker outputs.", UsedBy: "Migration preflight"},
	{Prefix: "curl ", Category: "migration-common", Description: "Download VMDK/VHD/OVA artefacts from the source hypervisor.", UsedBy: "Migration disk download"},
	{Prefix: "qemu-img ", Category: "migration-common", Description: "Convert disk images between formats.", UsedBy: "Migration disk conversion"},
	{Prefix: "timeout ", Category: "migration-common", Description: "Bound long-running migration subprocesses.", UsedBy: "Migration pipelines"},
	{Prefix: "rm -f /tmp/", Category: "migration-common", Description: "Clean up migration artefacts in /tmp.", UsedBy: "Migration cleanup"},
	{Prefix: "pvesm ", Category: "migration-common", Description: "Allocate volumes on Proxmox storage.", UsedBy: "Migration block streaming"},
	{Prefix: "rbd map ", Category: "migration-common", Description: "Map a Ceph RBD volume as a block device.", UsedBy: "Migration block streaming"},
	{Prefix: "rbd unmap ", Category: "migration-common", Description: "Unmap a Ceph RBD volume.", UsedBy: "Migration cleanup"},
	{Prefix: "cat \"", Category: "migration-common", Description: "Read files in double-quoted paths (migration temp files).", UsedBy: "Migration pipelines"},
	{Prefix: "cat '", Category: "migration-common", Description: "Read files in single-quoted paths (migration temp files).", UsedBy: "Migration pipelines"},
	{Prefix: "stat -c %s \"", Category: "migration-common", Description: "Read size of migration temp files (double-quoted).", UsedBy: "Migration progress tracking"},
	{Prefix: "stat -c '%s' '", Category: "migration-common", Description: "Read size of migration temp files (single-quoted).", UsedBy: "Migration progress tracking"},
	{Prefix: "rm -f \"", Category: "migration-common", Description: "Delete migration temp files by quoted path.", UsedBy: "Migration cleanup"},
	{Prefix: "tail -c ", Category: "migration-common", Description: "Stream the last N bytes of a progress log.", UsedBy: "Migration progress tracking"},
	{Prefix: "cat > \"", Category: "migration-common", Description: "Write content to a quoted temp file path.", UsedBy: "Migration pipelines"},
	{Prefix: "mkdir -p ", Category: "migration-common", Description: "Create temp/storage directories.", UsedBy: "Migration pipelines"},

	// -------- migration-esxi --------
	{Prefix: "export SSHPASS=", Category: "migration-esxi", Description: "Provide the ESXi password to sshpass for nested SSH.", UsedBy: "Migration > ESXi source"},

	// -------- migration-sshfs --------
	{Prefix: "grep -q ", Category: "migration-sshfs", Description: "Probe /etc/fuse.conf configuration.", UsedBy: "Migration SSHFS boot"},
	{Prefix: "sed -i ", Category: "migration-sshfs", Description: "Enable user_allow_other in /etc/fuse.conf.", UsedBy: "Migration SSHFS boot"},
	{Prefix: "fusermount ", Category: "migration-sshfs", Description: "Mount/unmount a FUSE filesystem (SSHFS).", UsedBy: "Migration SSHFS boot"},
	{Prefix: "ssh-keygen ", Category: "migration-sshfs", Description: "Generate an ephemeral SSH key pair for SSHFS nested session.", UsedBy: "Migration SSHFS boot"},
	{Prefix: "ssh -i ", Category: "migration-sshfs", Description: "Nested SSH into the source hypervisor using the ephemeral key.", UsedBy: "Migration SSHFS boot"},
	{Prefix: "aa-complain ", Category: "migration-sshfs", Description: "Put qemu AppArmor profile in complain mode.", UsedBy: "Migration SSHFS boot"},
	{Prefix: "aa-enforce ", Category: "migration-sshfs", Description: "Restore qemu AppArmor profile to enforce mode.", UsedBy: "Migration SSHFS boot"},
	{Prefix: "apparmor_parser ", Category: "migration-sshfs", Description: "Reload the AppArmor policy after modifying the qemu profile.", UsedBy: "Migration SSHFS boot"},
	{Prefix: "modprobe ", Category: "migration-sshfs", Description: "Load the nbd kernel module.", UsedBy: "Migration SSHFS boot"},
	{Prefix: "qemu-nbd ", Category: "migration-sshfs", Description: "Attach/detach a qcow2 file via NBD.", UsedBy: "Migration SSHFS boot"},
	{Prefix: "fuser ", Category: "migration-sshfs", Description: "Check processes using an NBD device before disconnect.", UsedBy: "Migration SSHFS cleanup"},
	{Prefix: "chmod ", Category: "migration-sshfs", Description: "Tighten permissions on the ephemeral key file.", UsedBy: "Migration SSHFS boot"},

	// -------- migration-vcenter-v2v --------
	{Prefix: "virt-v2v ", Category: "migration-vcenter-v2v", Description: "Convert the source VM disk to Proxmox using virt-v2v.", UsedBy: "Migration > vCenter"},
	{Prefix: "apt-get ", Category: "migration-vcenter-v2v", Description: "Install virt-v2v and dependencies on the PVE node.", UsedBy: "Migration > vCenter preflight"},
	{Prefix: "pv ", Category: "migration-vcenter-v2v", Description: "Report progress of streamed conversion output.", UsedBy: "Migration > vCenter"},
	{Prefix: "printf ", Category: "migration-vcenter-v2v", Description: "Write the vCenter password to a temp file securely.", UsedBy: "Migration > vCenter credentials"},
	{Prefix: "df ", Category: "migration-vcenter-v2v", Description: "Check free space on the migration working directory.", UsedBy: "Migration > vCenter preflight"},
	{Prefix: "test -f /usr/share/virtio-win", Category: "migration-vcenter-v2v", Description: "Verify the virtio-win ISO is present for Windows conversions.", UsedBy: "Migration > vCenter preflight"},

	// -------- migration-hyperv --------
	{Prefix: "find /mnt/hyperv ", Category: "migration-hyperv", Description: "Scan the mounted Hyper-V share for disk files.", UsedBy: "Migration > Hyper-V"},
	{Prefix: "mount -t cifs ", Category: "migration-hyperv", Description: "Mount the Hyper-V source SMB share.", UsedBy: "Migration > Hyper-V"},
	{Prefix: "umount /mnt/hyperv", Category: "migration-hyperv", Description: "Unmount the Hyper-V source SMB share.", UsedBy: "Migration > Hyper-V cleanup"},
	{Prefix: "mountpoint ", Category: "migration-hyperv", Description: "Check whether the Hyper-V mount is active.", UsedBy: "Migration > Hyper-V"},

	// -------- network-flows --------
	{Prefix: "ovs-vsctl ", Category: "network-flows", Description: "Query and configure Open vSwitch bridges and sFlow agents.", UsedBy: "Operations > Network Flows"},
	{Prefix: "ovs-ofctl ", Category: "network-flows", Description: "Inspect OpenFlow tables on OVS bridges.", UsedBy: "Operations > Network Flows port mapping"},
	{Prefix: "ip -o link", Category: "network-flows", Description: "List interfaces with SNMP ifIndex (one line per interface).", UsedBy: "Operations > Network Flows port mapping"},
	{Prefix: "ip link", Category: "network-flows", Description: "List interfaces (fallback listing).", UsedBy: "Operations > Network Flows port mapping"},
	{Prefix: "for br in $(ovs-vsctl list-br)", Category: "network-flows", Description: "Apply sFlow configuration on every OVS bridge.", UsedBy: "Operations > Network Flows > Configure sFlow"},

	// -------- preflight --------
	{Prefix: "which ", Category: "preflight", Description: "Check whether an executable is installed.", UsedBy: "Migration and node preflight"},
	{Prefix: "test -f ", Category: "preflight", Description: "Check that a file exists.", UsedBy: "Migration SSHFS / virtio-win preflight"},
	{Prefix: "test -S ", Category: "preflight", Description: "Check that a path is a socket.", UsedBy: "Migration preflight"},
	{Prefix: "ls \"", Category: "preflight", Description: "List files in a double-quoted path.", UsedBy: "Migration preflight"},
	{Prefix: "ls -1 '", Category: "preflight", Description: "List files one-per-line in a single-quoted path.", UsedBy: "Migration preflight"},
}

// categoryMetadata supplies the human label and description for each
// Category id used in allowedCommands. Keys MUST cover every Category
// referenced above — handleSSHAllowlist panics if not.
var categoryMetadata = map[string]struct {
	Label       string
	Description string
	Order       int
}{
	"network-flows":          {"Network Flows (sFlow / OVS)", "Queries and configures Open vSwitch to collect network flows.", 1},
	"migration-common":       {"Migration — Disk transfer & conversion", "Shared building blocks for every migration source.", 2},
	"migration-esxi":         {"Migration — VMware ESXi", "Nested SSH to an ESXi host for disk export.", 3},
	"migration-vcenter-v2v":  {"Migration — vCenter (virt-v2v)", "Runs virt-v2v on the PVE node to convert a VM from vCenter.", 4},
	"migration-hyperv":       {"Migration — Hyper-V", "Mounts a Hyper-V SMB share and scans for disks.", 5},
	"migration-sshfs":        {"Migration — SSHFS boot path", "Uses FUSE+SSHFS+NBD to stream-convert very large disks.", 6},
	"node-management":        {"Node & VM management", "Core Proxmox operations run against VMs, containers, and HA.", 7},
	"preflight":              {"Preflight checks", "Non-destructive probes used before migrations and upgrades.", 8},
}
// Note: XCP-ng migrations reuse the `migration-common` prefixes (curl, qemu-img,
// …). If XCP-ng-specific prefixes are added later, introduce a `migration-xcpng`
// category here and tag commands accordingly.
```

- [ ] **Step 4: Wire handleSSHExec to the new slice**

Open `/root/saas/proxcenter-backend/internal/api/ssh.go`. Find the declaration of `allowedPrefixes := []string{` (around line 347) and the `for _, allowed := range allowedPrefixes` loop a few lines later. Replace the literal `allowedPrefixes := []string{ ... }` block with:

```go
		// Security: Only allow specific commands for VM/node management
		// Strip sudo prefix before checking allowlist (sudo is added by frontend when sshUseSudo is enabled)
		cmdToCheck := req.Command
		if strings.HasPrefix(cmdToCheck, "sudo ") {
			cmdToCheck = strings.TrimPrefix(cmdToCheck, "sudo ")
		}

		commandAllowed := false
		for _, ac := range allowedCommands {
			if strings.HasPrefix(cmdToCheck, ac.Prefix) {
				commandAllowed = true
				break
			}
		}
```

Delete the `allowedPrefixes := []string{ ... }` literal and the old `for _, allowed := range allowedPrefixes` loop that it fed. Leave the `// Additional regex-based validation for rm commands on virt-v2v temp directories` block that follows completely unchanged — it is a separate layer and unrelated to the refactor.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /root/saas/proxcenter-backend && go test ./internal/api/... -run TestAllowlist -v
```
Expected: PASS on all three tests.

- [ ] **Step 6: Run the full package tests for safety**

```bash
cd /root/saas/proxcenter-backend && go build ./... && go test ./internal/api/... -v
```
Expected: build OK, all existing tests green.

- [ ] **Step 7: Ask user for commit approval (per `feedback_no_autocommit`). On approval:**

```bash
cd /root/saas/proxcenter-backend && git add internal/api/ssh.go internal/api/ssh_allowlist.go internal/api/ssh_allowlist_test.go && git commit -m "refactor(api): structure SSH allowlist as typed AllowedCommand slice

Move the []string allowedPrefixes literal out of handleSSHExec into a
package-level []AllowedCommand in ssh_allowlist.go carrying Category/
Description/UsedBy metadata. Matching semantics in handleSSHExec are
unchanged.

Add a table-driven non-regression test that iterates over the frozen
historical prefix list and fails if any entry is dropped. Prepares the
ground for the new GET /api/v1/ssh/allowlist endpoint (#267)."
```

---

## Task 2: Add `GET /api/v1/ssh/allowlist` endpoint

**Why:** frontend needs a single JSON response that groups commands by category, ordered by `Order`, ready to render. We build this server-side so the frontend stays dumb.

**Files:**
- Modify: `/root/saas/proxcenter-backend/internal/api/ssh.go:67-71` (add the GET route registration)
- Modify: `/root/saas/proxcenter-backend/internal/api/ssh_allowlist.go` (add `handleSSHAllowlist`)
- Test: `/root/saas/proxcenter-backend/internal/api/ssh_allowlist_test.go` (extend)

- [ ] **Step 1: Write the failing test**

Open `/root/saas/proxcenter-backend/internal/api/ssh_allowlist_test.go`. Extend the existing imports at the top of the file (from Task 1 the file only imports `"testing"`) to:

```go
import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)
```

Then append the new tests at the end of the file:

```go

func TestHandleSSHAllowlist(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ssh/allowlist", nil)
	rr := httptest.NewRecorder()

	handleSSHAllowlist(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}

	var resp struct {
		Categories []AllowlistCategory `json:"categories"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if len(resp.Categories) == 0 {
		t.Fatalf("got zero categories")
	}

	// Every command in every category must have full metadata.
	seenCategoryIDs := map[string]bool{}
	for _, cat := range resp.Categories {
		if cat.ID == "" || cat.Label == "" {
			t.Errorf("category with empty ID or Label: %+v", cat)
		}
		if seenCategoryIDs[cat.ID] {
			t.Errorf("duplicate category id %q", cat.ID)
		}
		seenCategoryIDs[cat.ID] = true
		if len(cat.Commands) == 0 {
			t.Errorf("category %q has zero commands", cat.ID)
		}
		for _, c := range cat.Commands {
			if c.Prefix == "" || c.Description == "" || c.UsedBy == "" {
				t.Errorf("command in %q has empty field: %+v", cat.ID, c)
			}
		}
	}

	// Must contain the specific category we expect for the demo case.
	if !seenCategoryIDs["network-flows"] {
		t.Errorf("expected network-flows category in response")
	}
}

// TestAllCommandCategoriesHaveMetadata guards against referencing an
// unknown Category id in allowedCommands.
func TestAllCommandCategoriesHaveMetadata(t *testing.T) {
	for _, ac := range allowedCommands {
		if _, ok := categoryMetadata[ac.Category]; !ok {
			t.Errorf("prefix %q references unknown Category %q", ac.Prefix, ac.Category)
		}
	}
}
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /root/saas/proxcenter-backend && go test ./internal/api/... -run TestHandleSSHAllowlist -v
```
Expected: FAIL with "undefined: handleSSHAllowlist".

- [ ] **Step 3: Implement the handler**

Open `/root/saas/proxcenter-backend/internal/api/ssh_allowlist.go`. Directly below the `package api` line, insert an imports block (the file has none yet):

```go
package api

import (
	"encoding/json"
	"net/http"
	"sort"
)
```

Then append this function at the end of the file (after `categoryMetadata`):

```go
// handleSSHAllowlist serves the full structured allowlist for the
// /settings?tab=ssh-commands UI in the frontend.
//
// Route: GET /api/v1/ssh/allowlist (registered in RegisterSSHRoutes).
// Response: {"categories": [{id, label, description, commands: [...]}, ...]}
// Ordering: categoryMetadata[id].Order, ascending.
func handleSSHAllowlist(w http.ResponseWriter, _ *http.Request) {
	// Group commands by category.
	byCat := map[string][]AllowedCommand{}
	for _, ac := range allowedCommands {
		byCat[ac.Category] = append(byCat[ac.Category], ac)
	}

	cats := make([]AllowlistCategory, 0, len(byCat))
	for id, cmds := range byCat {
		meta, ok := categoryMetadata[id]
		if !ok {
			// Skip unknown categories (defensively — TestAllCommandCategoriesHaveMetadata
			// catches this at build time, but we guard at runtime to avoid a panic
			// in production if a future edit forgets to update categoryMetadata).
			continue
		}
		cats = append(cats, AllowlistCategory{
			ID:          id,
			Label:       meta.Label,
			Description: meta.Description,
			Commands:    cmds,
		})
	}

	sort.Slice(cats, func(i, j int) bool {
		return categoryMetadata[cats[i].ID].Order < categoryMetadata[cats[j].ID].Order
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"categories": cats})
}
```

- [ ] **Step 4: Register the route**

Open `/root/saas/proxcenter-backend/internal/api/ssh.go`. Find `RegisterSSHRoutes`:

```go
func (s *Server) RegisterSSHRoutes(r chi.Router) {
	r.Post("/ssh/test", s.handleTestSSHConnection)
	r.Post("/ssh/exec", s.handleSSHExec)
}
```

Add the new GET line:

```go
func (s *Server) RegisterSSHRoutes(r chi.Router) {
	r.Post("/ssh/test", s.handleTestSSHConnection)
	r.Post("/ssh/exec", s.handleSSHExec)
	r.Get("/ssh/allowlist", handleSSHAllowlist)
}
```

- [ ] **Step 5: Run all allowlist tests**

```bash
cd /root/saas/proxcenter-backend && go test ./internal/api/... -run Allowlist -v
```
Expected: all tests PASS (`TestAllowlistNonRegression`, `TestAllowlistNoDuplicatePrefixes`, `TestAllowlistAllCommandsHaveMetadata`, `TestHandleSSHAllowlist`, `TestAllCommandCategoriesHaveMetadata`).

- [ ] **Step 6: Commit (ask user first)**

```bash
cd /root/saas/proxcenter-backend && git add internal/api/ssh.go internal/api/ssh_allowlist.go internal/api/ssh_allowlist_test.go && git commit -m "feat(api): expose GET /api/v1/ssh/allowlist

Serves the structured allowlist grouped by category, ordered by
categoryMetadata[id].Order, so the frontend /settings?tab=ssh-commands
page can render without duplicating the list client-side.

Covered by TestHandleSSHAllowlist and TestAllCommandCategoriesHaveMetadata."
```

---

## Task 3: Next.js proxy route `/api/v1/ssh/allowlist`

**Why:** the frontend must not hit the orchestrator directly from the browser (network policy + auth). A thin proxy route under the Next.js API surface forwards the request and applies `CONNECTION_VIEW` RBAC.

**Files:**
- Create: `/root/saas/proxcenter-frontend/frontend/src/app/api/v1/ssh/allowlist/route.ts`

- [ ] **Step 1: Create the proxy route**

Create `/root/saas/proxcenter-frontend/frontend/src/app/api/v1/ssh/allowlist/route.ts`:

```typescript
import { NextResponse } from "next/server"

import { orchestratorFetch } from "@/lib/orchestrator"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/ssh/allowlist
// Proxies to the orchestrator and returns the structured allowlist.
// Any user with CONNECTION_VIEW can read this — it is not sensitive
// (no credentials, no hostnames — just the command schema).
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const data = await orchestratorFetch("/ssh/allowlist")
    return NextResponse.json(data)
  } catch (error: any) {
    if ((error as any)?.code !== "ORCHESTRATOR_UNAVAILABLE") {
      console.error("Failed to fetch SSH allowlist:", String(error?.message || "").replace(/[\r\n]/g, ""))
    }
    return NextResponse.json(
      { error: error.message || "Failed to fetch SSH allowlist" },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Manual verification**

Start the frontend dev server in a second terminal if not already running. Then:

```bash
curl -sS -b "next-auth.session-token=<your session cookie>" http://localhost:3000/api/v1/ssh/allowlist | jq '.categories | length'
```

Expected: a positive integer (current design has 9 categories).

- [ ] **Step 3: Commit (ask user first)**

```bash
cd /root/saas/proxcenter-frontend && git add frontend/src/app/api/v1/ssh/allowlist/route.ts && git commit -m "feat(api): add /api/v1/ssh/allowlist proxy to orchestrator"
```

---

## Task 4: Scaffold `SshCommandsTab` + register in Settings

**Why:** getting the tab visible and wired up early makes every subsequent card verifiable in the real UI. We start with a skeleton that just renders the three Card placeholders.

**Files:**
- Create: `/root/saas/proxcenter-frontend/frontend/src/components/settings/SshCommandsTab.jsx`
- Modify: `/root/saas/proxcenter-frontend/frontend/src/app/(dashboard)/settings/page.jsx:52-86` (add dynamic import), `:2603-2617` (add to `allTabNames` and `allTabs`)
- Modify: `/root/saas/proxcenter-frontend/frontend/src/messages/en.json` (add `settings.sshCommands.tabLabel`, `.page.title`, `.page.subtitle` placeholders)

- [ ] **Step 1: Create the tab shell component**

Create `/root/saas/proxcenter-frontend/frontend/src/components/settings/SshCommandsTab.jsx`:

```jsx
'use client'

import { useTranslations } from 'next-intl'
import { Box, Card, CardContent, Stack, Typography } from '@mui/material'

export default function SshCommandsTab() {
  const t = useTranslations()

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant='h5' fontWeight={600}>
          {t('settings.sshCommands.page.title')}
        </Typography>
        <Typography variant='body2' color='text.secondary'>
          {t('settings.sshCommands.page.subtitle')}
        </Typography>
      </Box>

      <Card variant='outlined'>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={600} gutterBottom>
            {t('settings.sshCommands.status.heading')}
          </Typography>
          <Typography variant='body2' color='text.secondary'>
            {/* ConnectionStatusCard placeholder — Task 5 */}
            …
          </Typography>
        </CardContent>
      </Card>

      <Card variant='outlined'>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={600} gutterBottom>
            {t('settings.sshCommands.recs.heading')}
          </Typography>
          <Typography variant='body2' color='text.secondary'>
            {/* SecurityRecommendationsCard placeholder — Task 8 */}
            …
          </Typography>
        </CardContent>
      </Card>

      <Card variant='outlined'>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={600} gutterBottom>
            {t('settings.sshCommands.allowlist.heading')}
          </Typography>
          <Typography variant='body2' color='text.secondary'>
            {/* AllowlistCard placeholder — Task 7 */}
            …
          </Typography>
        </CardContent>
      </Card>
    </Stack>
  )
}
```

- [ ] **Step 2: Add placeholder i18n keys in en.json**

Open `/root/saas/proxcenter-frontend/frontend/src/messages/en.json`. Find the `"settings": {` block that starts around line 1770 (the main one, not nested ones). Locate a sibling like `"notifications": { … },` and insert a new sibling before the closing `}` of the main `"settings"` block:

```json
    "sshCommands": {
      "tabLabel": "SSH Commands",
      "page": {
        "title": "SSH commands executed on your nodes",
        "subtitle": "Full list of commands ProxCenter runs over SSH, grouped by purpose, with a sudoers template to run as a dedicated user."
      },
      "status": {
        "heading": "Your PVE connections",
        "loading": "Loading connections…",
        "noConnections": "No PVE connection configured yet.",
        "rootWarning": "All connections use root. Consider switching to a dedicated user with sudo for audit trails and reduced compromise scope.",
        "partial": "Partially hardened: some connections still use root.",
        "hardened": "Hardened: all connections use a dedicated user with sudo.",
        "chipRoot": "All root",
        "chipPartial": "Partially hardened",
        "chipHardened": "Hardened",
        "summary": "{total} PVE {total, plural, one {connection} other {connections}}: {root} use root, {sudo} use a dedicated user with sudo, {plain} use a dedicated user without sudo."
      },
      "recs": {
        "heading": "Security recommendations",
        "intro": "For lab or single-admin setups, root is acceptable if SSH keys are properly managed. For production, multi-admin, or compliance-sensitive environments, a dedicated user with sudo is recommended: you get an audit trail in /var/log/auth.log and compromise is scoped to the whitelisted commands.",
        "step1Title": "Create a dedicated SSH user on each PVE node",
        "step1Hint": "Run these commands on every PVE node (adapt the public key to yours).",
        "step2Title": "Install the sudoers template",
        "step2Hint": "Copy the template, paste it into /etc/sudoers.d/proxcenter on every PVE node, and validate with visudo -c.",
        "step3Title": "Switch the ProxCenter connection to the new user",
        "step3Hint": "In Settings > Connections > PVE, edit each connection, change the SSH user to proxcenter, and enable Use sudo.",
        "copyTemplate": "Copy sudoers template",
        "copyInstall": "Copy install command",
        "copied": "Copied to clipboard",
        "disclaimer": "Note: the command allowlist is applied when commands route through the embedded orchestrator. Some code paths (migrations, direct node operations) bypass this check today. A security-hardening task is tracked to extend strict enforcement; running ProxCenter under a dedicated user with sudo already provides OS-level audit trail (/var/log/auth.log) and scopes compromise impact.",
        "shellWrapWarning": "A few commands use shell constructs (for-loops over OVS bridges) that cannot be expressed as simple sudoers exec rules. The template includes a scoped /bin/sh entry for these. If you prefer to avoid /bin/sh in sudoers, do not use the Network Flows sFlow configuration feature."
      },
      "allowlist": {
        "heading": "Command allowlist",
        "searchPlaceholder": "Filter commands…",
        "columnPrefix": "Command",
        "columnPurpose": "Purpose",
        "columnUsedBy": "Used by",
        "noResults": "No command matches your search.",
        "loading": "Loading allowlist…",
        "categoryCount": "{count} {count, plural, one {command} other {commands}}"
      },
      "errors": {
        "fetchFailed": "Failed to load the SSH command list.",
        "clipboardFailed": "Could not copy to clipboard.",
        "retry": "Retry"
      }
    },
```

(Put the trailing comma between this block and whichever sibling comes next; verify JSON validity before moving on.)

- [ ] **Step 3: Register the tab in settings page**

Open `/root/saas/proxcenter-frontend/frontend/src/app/(dashboard)/settings/page.jsx`.

**3a** — After the existing `dynamic()` imports block (around line 52-86), add:

```jsx
const SshCommandsTab = dynamic(() => import('@/components/settings/SshCommandsTab'), {
  ssr: false
})
```

**3b** — In `allTabNames` (line 2603), add `'ssh-commands'` at the end:

```jsx
const allTabNames = ['connections', 'appearance', 'alert-thresholds', 'notifications', 'ldap', 'oidc', 'license', 'ai', 'green', 'white-label', 'tenants', 'ssh-commands']
```

**3c** — In `allTabs` (line 2605), add the entry at the end of the array (after the Tenants entry). Preserve the trailing newline and closing `]`:

```jsx
    { label: t('settings.sshCommands.tabLabel'), icon: 'ri-terminal-line', component: SshCommandsTab },
```

- [ ] **Step 4: Verify manually**

User verifies the tab is visible at http://localhost:3000/settings?tab=ssh-commands with the three placeholder cards.

- [ ] **Step 5: Commit (ask user first)**

```bash
cd /root/saas/proxcenter-frontend && git add frontend/src/components/settings/SshCommandsTab.jsx frontend/src/app/\(dashboard\)/settings/page.jsx frontend/src/messages/en.json && git commit -m "feat(settings): scaffold SSH Commands tab

New main tab at /settings?tab=ssh-commands with three placeholder
cards (connection status, security recommendations, command allowlist)
to be filled by subsequent tasks. Part of issue #267."
```

---

## Task 5: Connection Status Card

**Why:** shows the customer their current posture and drives the decision to follow the recommendations below. Reads the existing `/api/v1/connections` route — no new backend code.

**Files:**
- Create: `/root/saas/proxcenter-frontend/frontend/src/components/settings/ssh-commands/ConnectionStatusCard.jsx`
- Modify: `/root/saas/proxcenter-frontend/frontend/src/components/settings/SshCommandsTab.jsx` (swap placeholder for the real component)

- [ ] **Step 1: Create the component**

Create `/root/saas/proxcenter-frontend/frontend/src/components/settings/ssh-commands/ConnectionStatusCard.jsx`:

```jsx
'use client'

import useSWR from 'swr'
import { useTranslations } from 'next-intl'
import { Alert, Box, Card, CardContent, Chip, Skeleton, Stack, Typography } from '@mui/material'

const fetcher = url => fetch(url).then(r => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
})

export default function ConnectionStatusCard() {
  const t = useTranslations()
  const { data, error, isLoading } = useSWR('/api/v1/connections', fetcher)

  const pve = Array.isArray(data?.data) ? data.data.filter(c => c.type === 'pve') : []
  const total = pve.length
  const root = pve.filter(c => (c.sshUser || 'root') === 'root').length
  const sudo = pve.filter(c => (c.sshUser || 'root') !== 'root' && c.sshUseSudo).length
  const plain = pve.filter(c => (c.sshUser || 'root') !== 'root' && !c.sshUseSudo).length

  let chipKey = 'chipRoot'
  let chipColor = 'warning'
  if (total === 0) {
    chipKey = 'chipRoot'
    chipColor = 'default'
  } else if (root === 0 && plain === 0) {
    chipKey = 'chipHardened'
    chipColor = 'success'
  } else if (root < total) {
    chipKey = 'chipPartial'
    chipColor = 'info'
  }

  return (
    <Card variant='outlined'>
      <CardContent>
        <Stack direction='row' alignItems='center' justifyContent='space-between' sx={{ mb: 1 }}>
          <Typography variant='subtitle1' fontWeight={600}>
            {t('settings.sshCommands.status.heading')}
          </Typography>
          {!isLoading && !error && (
            <Chip size='small' color={chipColor} label={t(`settings.sshCommands.status.${chipKey}`)} />
          )}
        </Stack>

        {isLoading && <Skeleton variant='text' width='60%' />}

        {error && (
          <Alert severity='error'>{t('settings.sshCommands.errors.fetchFailed')}</Alert>
        )}

        {!isLoading && !error && total === 0 && (
          <Typography variant='body2' color='text.secondary'>
            {t('settings.sshCommands.status.noConnections')}
          </Typography>
        )}

        {!isLoading && !error && total > 0 && (
          <Box>
            <Typography variant='body2'>
              {t('settings.sshCommands.status.summary', { total, root, sudo, plain })}
            </Typography>
            {root === total && (
              <Alert severity='warning' sx={{ mt: 1.5 }} icon={<i className='ri-shield-line' />}>
                {t('settings.sshCommands.status.rootWarning')}
              </Alert>
            )}
            {root > 0 && root < total && (
              <Alert severity='info' sx={{ mt: 1.5 }}>
                {t('settings.sshCommands.status.partial')}
              </Alert>
            )}
            {root === 0 && plain === 0 && (
              <Alert severity='success' sx={{ mt: 1.5 }} icon={<i className='ri-shield-check-line' />}>
                {t('settings.sshCommands.status.hardened')}
              </Alert>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Swap placeholder in SshCommandsTab**

In `/root/saas/proxcenter-frontend/frontend/src/components/settings/SshCommandsTab.jsx`, replace the first `<Card variant='outlined'>…</Card>` block (the connection status placeholder) with:

```jsx
import ConnectionStatusCard from './ssh-commands/ConnectionStatusCard'
```

at the top, and in the JSX body:

```jsx
      <ConnectionStatusCard />
```

Remove the placeholder card block entirely.

- [ ] **Step 3: Manual verification**

User opens `/settings?tab=ssh-commands` and confirms:
- With all-root connections, the warning alert is shown
- With a mix, the info alert is shown
- With all sudo+non-root, the success alert is shown
- With zero PVE connections, the empty-state message is shown

- [ ] **Step 4: Commit (ask user first)**

```bash
cd /root/saas/proxcenter-frontend && git add frontend/src/components/settings/ssh-commands/ConnectionStatusCard.jsx frontend/src/components/settings/SshCommandsTab.jsx && git commit -m "feat(settings/ssh-commands): add Connection Status card"
```

---

## Task 6: Allowlist Card (search + category accordions)

**Why:** this is the meat of the page — every command visible with purpose and attribution. Simple search filters live across `prefix`, `description`, `usedBy`.

**Files:**
- Create: `/root/saas/proxcenter-frontend/frontend/src/components/settings/ssh-commands/AllowlistCard.jsx`
- Modify: `/root/saas/proxcenter-frontend/frontend/src/components/settings/SshCommandsTab.jsx`

- [ ] **Step 1: Create the component**

Create `/root/saas/proxcenter-frontend/frontend/src/components/settings/ssh-commands/AllowlistCard.jsx`:

```jsx
'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { useTranslations } from 'next-intl'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  InputAdornment,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material'

const fetcher = url => fetch(url).then(r => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
})

function filterCategories(categories, query) {
  if (!query) return categories
  const q = query.toLowerCase()
  return categories
    .map(cat => ({
      ...cat,
      commands: cat.commands.filter(c =>
        c.prefix.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.usedBy.toLowerCase().includes(q)
      )
    }))
    .filter(cat => cat.commands.length > 0)
}

export default function AllowlistCard() {
  const t = useTranslations()
  const { data, error, isLoading } = useSWR('/api/v1/ssh/allowlist', fetcher)
  const [query, setQuery] = useState('')

  const categories = useMemo(() => {
    if (!data?.categories) return []
    return filterCategories(data.categories, query)
  }, [data, query])

  return (
    <Card variant='outlined'>
      <CardContent>
        <Typography variant='subtitle1' fontWeight={600} gutterBottom>
          {t('settings.sshCommands.allowlist.heading')}
        </Typography>

        {error && (
          <Alert severity='error' sx={{ mb: 2 }}>
            {t('settings.sshCommands.errors.fetchFailed')}
          </Alert>
        )}

        <TextField
          fullWidth
          size='small'
          placeholder={t('settings.sshCommands.allowlist.searchPlaceholder')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          sx={{ mb: 2 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position='start'>
                <i className='ri-search-line' />
              </InputAdornment>
            )
          }}
        />

        {isLoading && (
          <Stack spacing={1}>
            <Skeleton variant='rounded' height={48} />
            <Skeleton variant='rounded' height={48} />
            <Skeleton variant='rounded' height={48} />
          </Stack>
        )}

        {!isLoading && !error && categories.length === 0 && (
          <Typography variant='body2' color='text.secondary'>
            {t('settings.sshCommands.allowlist.noResults')}
          </Typography>
        )}

        {!isLoading && !error && categories.map(cat => (
          <Accordion
            key={cat.id}
            defaultExpanded={Boolean(query)}
            disableGutters
            variant='outlined'
            sx={{ mb: 1 }}
          >
            <AccordionSummary expandIcon={<i className='ri-arrow-down-s-line' />}>
              <Stack direction='row' alignItems='center' spacing={1.5} sx={{ width: '100%' }}>
                <Typography variant='body1' fontWeight={600}>
                  {cat.label}
                </Typography>
                <Chip size='small' label={t('settings.sshCommands.allowlist.categoryCount', { count: cat.commands.length })} />
                {cat.description && (
                  <Typography variant='caption' color='text.secondary' sx={{ ml: 'auto', display: { xs: 'none', md: 'block' } }}>
                    {cat.description}
                  </Typography>
                )}
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <Table size='small'>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('settings.sshCommands.allowlist.columnPrefix')}</TableCell>
                    <TableCell>{t('settings.sshCommands.allowlist.columnPurpose')}</TableCell>
                    <TableCell>{t('settings.sshCommands.allowlist.columnUsedBy')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {cat.commands.map(c => (
                    <TableRow key={c.prefix}>
                      <TableCell>
                        <Box component='code' sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.85rem', backgroundColor: 'action.hover', px: 0.75, py: 0.25, borderRadius: 0.5 }}>
                          {c.prefix}
                        </Box>
                      </TableCell>
                      <TableCell>{c.description}</TableCell>
                      <TableCell>
                        <Typography variant='caption' color='text.secondary'>{c.usedBy}</Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </AccordionDetails>
          </Accordion>
        ))}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Swap the placeholder in SshCommandsTab**

In `/root/saas/proxcenter-frontend/frontend/src/components/settings/SshCommandsTab.jsx`, add import:

```jsx
import AllowlistCard from './ssh-commands/AllowlistCard'
```

Replace the allowlist placeholder card block with:

```jsx
      <AllowlistCard />
```

- [ ] **Step 3: Manual verification**

User opens `/settings?tab=ssh-commands` and confirms:
- 8 categories are visible as collapsed accordions (network-flows, migration-common, migration-esxi, migration-vcenter-v2v, migration-hyperv, migration-sshfs, node-management, preflight)
- Clicking expands with a 3-column table
- Typing `ovs` filters to just the Network Flows category; typing `migration` shows 5 migration categories
- The empty query `nonsense-xyz` shows the "no results" message

- [ ] **Step 4: Commit (ask user first)**

```bash
cd /root/saas/proxcenter-frontend && git add frontend/src/components/settings/ssh-commands/AllowlistCard.jsx frontend/src/components/settings/SshCommandsTab.jsx && git commit -m "feat(settings/ssh-commands): add searchable Allowlist card"
```

---

## Task 7: Sudoers template generator (pure function)

**Why:** generating the template is a pure, easily-testable transformation. We keep it in its own file so components stay simple.

**Files:**
- Create: `/root/saas/proxcenter-frontend/frontend/src/components/settings/ssh-commands/sudoersTemplate.ts`

- [ ] **Step 1: Create the template generator**

Create `/root/saas/proxcenter-frontend/frontend/src/components/settings/ssh-commands/sudoersTemplate.ts`:

```typescript
// sudoersTemplate builds a /etc/sudoers.d/proxcenter body from the
// orchestrator allowlist. Prefixes that are not bare executables (for
// example the `for br in $(ovs-vsctl list-br)` loop) are covered by a
// scoped `/bin/sh` entry — callers render a UI warning when any such
// shell-wrapped prefix is present.

export interface AllowlistCommand {
  prefix: string
  category: string
  description: string
  usedBy: string
}

export interface AllowlistCategoryShape {
  id: string
  label: string
  description: string
  commands: AllowlistCommand[]
}

// Maps a prefix to the absolute path of its main executable. Prefixes
// not listed here fall into the shellWrappedPrefixes bucket. Add entries
// only when the exec path is stable across Debian-based PVE installs.
const executablePathByPrefix: Record<string, string> = {
  'qm unlock': '/usr/sbin/qm',
  'qm status': '/usr/sbin/qm',
  'qm create': '/usr/sbin/qm',
  'qm set': '/usr/sbin/qm',
  'qm disk import': '/usr/sbin/qm',
  'qm start': '/usr/sbin/qm',
  'qm monitor ': '/usr/sbin/qm',
  'pct unlock': '/usr/sbin/pct',
  'pct status': '/usr/sbin/pct',
  'ha-manager crm-command node-maintenance': '/usr/sbin/ha-manager',
  'nohup bash': '/usr/bin/nohup',
  'cat /tmp/.proxcenter-upgrade-status': '/usr/bin/cat',
  'echo ': '/usr/bin/echo',
  'curl ': '/usr/bin/curl',
  'qemu-img ': '/usr/bin/qemu-img',
  'timeout ': '/usr/bin/timeout',
  'rm -f /tmp/': '/usr/bin/rm',
  'which ': '/usr/bin/which',
  'pvesm ': '/usr/sbin/pvesm',
  'rbd map ': '/usr/bin/rbd',
  'rbd unmap ': '/usr/bin/rbd',
  'cat \"': '/usr/bin/cat',
  "cat '": '/usr/bin/cat',
  'stat -c %s \"': '/usr/bin/stat',
  "stat -c '%s' '": '/usr/bin/stat',
  'rm -f \"': '/usr/bin/rm',
  'tail -c ': '/usr/bin/tail',
  'cat > \"': '/usr/bin/cat',
  'mkdir -p ': '/usr/bin/mkdir',
  'export SSHPASS=': '/usr/bin/sshpass',
  'grep -q ': '/usr/bin/grep',
  'sed -i ': '/usr/bin/sed',
  'fusermount ': '/usr/bin/fusermount',
  'test -f ': '/usr/bin/test',
  'test -S ': '/usr/bin/test',
  'ls \"': '/usr/bin/ls',
  "ls -1 '": '/usr/bin/ls',
  'ssh-keygen ': '/usr/bin/ssh-keygen',
  'ssh -i ': '/usr/bin/ssh',
  'aa-complain ': '/usr/sbin/aa-complain',
  'aa-enforce ': '/usr/sbin/aa-enforce',
  'apparmor_parser ': '/sbin/apparmor_parser',
  'modprobe ': '/usr/sbin/modprobe',
  'qemu-nbd ': '/usr/bin/qemu-nbd',
  'fuser ': '/usr/bin/fuser',
  'chmod ': '/usr/bin/chmod',
  'virt-v2v ': '/usr/bin/virt-v2v',
  'apt-get ': '/usr/bin/apt-get',
  'pv ': '/usr/bin/pv',
  'printf ': '/usr/bin/printf',
  'df ': '/usr/bin/df',
  'test -f /usr/share/virtio-win': '/usr/bin/test',
  'find /mnt/hyperv ': '/usr/bin/find',
  'mount -t cifs ': '/usr/bin/mount',
  'umount /mnt/hyperv': '/usr/bin/umount',
  'mountpoint ': '/usr/bin/mountpoint',
  'ovs-vsctl ': '/usr/bin/ovs-vsctl',
  'ovs-ofctl ': '/usr/bin/ovs-ofctl',
  'ip -o link': '/usr/sbin/ip',
  'ip link': '/usr/sbin/ip'
  // 'for br in $(ovs-vsctl list-br)' intentionally missing — shell-wrapped.
}

const SUDO_USER = 'proxcenter'

function escapeSudoersLine(s: string): string {
  return s.replace(/[\r\n]/g, ' ')
}

export function buildSudoersTemplate(categories: AllowlistCategoryShape[]): { body: string, shellWrappedCount: number } {
  const lines: string[] = [
    '# /etc/sudoers.d/proxcenter',
    '# Generated by ProxCenter (/settings?tab=ssh-commands).',
    '# Validate with: visudo -c -f /etc/sudoers.d/proxcenter',
    `Defaults:${SUDO_USER} !requiretty`,
    ''
  ]

  let shellWrappedCount = 0

  for (const cat of categories) {
    const byPath = new Map<string, string[]>()
    for (const cmd of cat.commands) {
      const path = executablePathByPrefix[cmd.prefix]
      if (!path) {
        shellWrappedCount++
        continue
      }
      if (!byPath.has(path)) byPath.set(path, [])
      byPath.get(path)!.push(cmd.prefix)
    }

    if (byPath.size === 0) continue

    lines.push(`# ${escapeSudoersLine(cat.label)}`)
    const paths = Array.from(byPath.keys()).sort()
    lines.push(`${SUDO_USER} ALL=(ALL) NOPASSWD: ${paths.join(', ')}`)
    lines.push('')
  }

  if (shellWrappedCount > 0) {
    lines.push('# Shell-wrapped commands (e.g. for-loop over OVS bridges for sFlow config).')
    lines.push('# Remove this line to disable shell-wrapped features such as Network Flows sFlow enable.')
    lines.push(`${SUDO_USER} ALL=(ALL) NOPASSWD: /bin/sh -c *`)
    lines.push('')
  }

  return { body: lines.join('\n'), shellWrappedCount }
}

export function buildInstallCommand(body: string): string {
  const escaped = body.replace(/'/g, `'\\''`)
  return `cat > /etc/sudoers.d/proxcenter <<'EOF'\n${body}\nEOF\nchmod 440 /etc/sudoers.d/proxcenter\nvisudo -c -f /etc/sudoers.d/proxcenter`
}
```

- [ ] **Step 2: Commit (ask user first)**

```bash
cd /root/saas/proxcenter-frontend && git add frontend/src/components/settings/ssh-commands/sudoersTemplate.ts && git commit -m "feat(settings/ssh-commands): add sudoers template generator"
```

---

## Task 8: Security Recommendations Card

**Why:** pulls the three accordion steps together, plugs in the template generator, and ships the honest disclaimer. This is the last piece of UI.

**Files:**
- Create: `/root/saas/proxcenter-frontend/frontend/src/components/settings/ssh-commands/SecurityRecommendationsCard.jsx`
- Modify: `/root/saas/proxcenter-frontend/frontend/src/components/settings/SshCommandsTab.jsx`

- [ ] **Step 1: Create the component**

Create `/root/saas/proxcenter-frontend/frontend/src/components/settings/ssh-commands/SecurityRecommendationsCard.jsx`:

```jsx
'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { useTranslations } from 'next-intl'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  Typography
} from '@mui/material'

import { buildSudoersTemplate, buildInstallCommand } from './sudoersTemplate'

const fetcher = url => fetch(url).then(r => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
})

const SETUP_BASH = `# Run on every PVE node (adapt the public key to yours)
adduser --system --shell /bin/bash --group proxcenter
mkdir -p /home/proxcenter/.ssh
echo "ssh-ed25519 AAAA... proxcenter@your-workstation" >> /home/proxcenter/.ssh/authorized_keys
chown -R proxcenter:proxcenter /home/proxcenter/.ssh
chmod 700 /home/proxcenter/.ssh
chmod 600 /home/proxcenter/.ssh/authorized_keys
# Needed for the Network Flows feature (direct OVS socket access)
usermod -aG openvswitch proxcenter
# IMPORTANT: reconnect the SSH session after this for the new group to take effect`

function CodeBlock({ text, onCopy }) {
  return (
    <Box sx={{ position: 'relative', mt: 1 }}>
      <Box
        component='pre'
        sx={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.8rem',
          backgroundColor: 'action.hover',
          p: 1.5,
          borderRadius: 1,
          overflow: 'auto',
          maxHeight: 280,
          m: 0
        }}
      >
        {text}
      </Box>
      <Button
        size='small'
        variant='outlined'
        onClick={onCopy}
        sx={{ position: 'absolute', top: 8, right: 8 }}
        startIcon={<i className='ri-file-copy-line' />}
      >
        Copy
      </Button>
    </Box>
  )
}

export default function SecurityRecommendationsCard() {
  const t = useTranslations()
  const { data } = useSWR('/api/v1/ssh/allowlist', fetcher)
  const [copied, setCopied] = useState('')

  const { body: templateBody, shellWrappedCount } = useMemo(() => {
    if (!data?.categories) return { body: '', shellWrappedCount: 0 }
    return buildSudoersTemplate(data.categories)
  }, [data])

  const installCommand = useMemo(
    () => (templateBody ? buildInstallCommand(templateBody) : ''),
    [templateBody]
  )

  const copy = async (label, text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(''), 2000)
    } catch {
      setCopied('error')
      setTimeout(() => setCopied(''), 2000)
    }
  }

  return (
    <Card variant='outlined'>
      <CardContent>
        <Typography variant='subtitle1' fontWeight={600} gutterBottom>
          {t('settings.sshCommands.recs.heading')}
        </Typography>
        <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
          {t('settings.sshCommands.recs.intro')}
        </Typography>

        <Accordion disableGutters variant='outlined' sx={{ mb: 1 }}>
          <AccordionSummary expandIcon={<i className='ri-arrow-down-s-line' />}>
            <Typography variant='body1' fontWeight={600}>
              1. {t('settings.sshCommands.recs.step1Title')}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant='body2' color='text.secondary'>
              {t('settings.sshCommands.recs.step1Hint')}
            </Typography>
            <CodeBlock text={SETUP_BASH} onCopy={() => copy('setup', SETUP_BASH)} />
          </AccordionDetails>
        </Accordion>

        <Accordion disableGutters variant='outlined' sx={{ mb: 1 }}>
          <AccordionSummary expandIcon={<i className='ri-arrow-down-s-line' />}>
            <Typography variant='body1' fontWeight={600}>
              2. {t('settings.sshCommands.recs.step2Title')}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant='body2' color='text.secondary'>
              {t('settings.sshCommands.recs.step2Hint')}
            </Typography>

            {shellWrappedCount > 0 && (
              <Alert severity='warning' sx={{ mt: 1.5 }} icon={<i className='ri-alert-line' />}>
                {t('settings.sshCommands.recs.shellWrapWarning')}
              </Alert>
            )}

            <Stack direction='row' spacing={1} sx={{ mt: 1.5, mb: 1 }}>
              <Button
                variant='contained'
                size='small'
                startIcon={<i className='ri-file-copy-line' />}
                onClick={() => copy('template', templateBody)}
                disabled={!templateBody}
              >
                {t('settings.sshCommands.recs.copyTemplate')}
              </Button>
              <Button
                variant='outlined'
                size='small'
                startIcon={<i className='ri-terminal-line' />}
                onClick={() => copy('install', installCommand)}
                disabled={!installCommand}
              >
                {t('settings.sshCommands.recs.copyInstall')}
              </Button>
              {copied && copied !== 'error' && (
                <Typography variant='caption' color='success.main' sx={{ alignSelf: 'center' }}>
                  {t('settings.sshCommands.recs.copied')}
                </Typography>
              )}
              {copied === 'error' && (
                <Typography variant='caption' color='error.main' sx={{ alignSelf: 'center' }}>
                  {t('settings.sshCommands.errors.clipboardFailed')}
                </Typography>
              )}
            </Stack>

            {templateBody && <CodeBlock text={templateBody} onCopy={() => copy('template', templateBody)} />}
          </AccordionDetails>
        </Accordion>

        <Accordion disableGutters variant='outlined' sx={{ mb: 1 }}>
          <AccordionSummary expandIcon={<i className='ri-arrow-down-s-line' />}>
            <Typography variant='body1' fontWeight={600}>
              3. {t('settings.sshCommands.recs.step3Title')}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant='body2' color='text.secondary'>
              {t('settings.sshCommands.recs.step3Hint')}
            </Typography>
          </AccordionDetails>
        </Accordion>

        <Alert severity='info' sx={{ mt: 2 }} icon={<i className='ri-information-line' />}>
          {t('settings.sshCommands.recs.disclaimer')}
        </Alert>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Swap placeholder in SshCommandsTab**

In `/root/saas/proxcenter-frontend/frontend/src/components/settings/SshCommandsTab.jsx`, add import:

```jsx
import SecurityRecommendationsCard from './ssh-commands/SecurityRecommendationsCard'
```

Replace the security recommendations placeholder card with:

```jsx
      <SecurityRecommendationsCard />
```

- [ ] **Step 3: Manual verification**

User opens `/settings?tab=ssh-commands` and confirms:
- All three accordions render and expand
- Step 1 shows a copyable bash block and the `usermod -aG openvswitch` line is present
- Step 2 shows the generated sudoers template, a **Copy sudoers template** button, a **Copy install command** button, and the shell-wrapped warning appears (since `for br in …` is in the allowlist)
- Clicking Copy buttons triggers the "Copied" confirmation
- The info disclaimer at the bottom matches the spec text

- [ ] **Step 4: Commit (ask user first)**

```bash
cd /root/saas/proxcenter-frontend && git add frontend/src/components/settings/ssh-commands/SecurityRecommendationsCard.jsx frontend/src/components/settings/SshCommandsTab.jsx && git commit -m "feat(settings/ssh-commands): add Security Recommendations card with sudoers template"
```

---

## Task 9: French, German, Chinese translations

**Why:** project rule `feedback_always_i18n` — every `t()` key MUST exist in all four locales, no fallbacks. We add the full `settings.sshCommands.*` block to fr/de/zh-CN with translations in the same factual, pragmatic tone as the English master (no alarmism, no dogma).

**Files:**
- Modify: `/root/saas/proxcenter-frontend/frontend/src/messages/fr.json`
- Modify: `/root/saas/proxcenter-frontend/frontend/src/messages/de.json`
- Modify: `/root/saas/proxcenter-frontend/frontend/src/messages/zh-CN.json`

- [ ] **Step 1: Add French translations**

Open `/root/saas/proxcenter-frontend/frontend/src/messages/fr.json`, locate the main `"settings": {` block (same position as in `en.json`), and insert before its closing `}`:

```json
    "sshCommands": {
      "tabLabel": "Commandes SSH",
      "page": {
        "title": "Commandes SSH exécutées sur vos nœuds",
        "subtitle": "Liste complète des commandes que ProxCenter exécute en SSH, regroupées par usage, avec un modèle sudoers pour tourner sous un utilisateur dédié."
      },
      "status": {
        "heading": "Vos connexions PVE",
        "loading": "Chargement des connexions…",
        "noConnections": "Aucune connexion PVE configurée pour le moment.",
        "rootWarning": "Toutes les connexions utilisent root. Passer à un utilisateur dédié avec sudo offre un journal d'audit et limite l'impact d'une compromission.",
        "partial": "Partiellement durci : certaines connexions utilisent encore root.",
        "hardened": "Durci : toutes les connexions utilisent un utilisateur dédié avec sudo.",
        "chipRoot": "Tout en root",
        "chipPartial": "Partiellement durci",
        "chipHardened": "Durci",
        "summary": "{total} {total, plural, one {connexion PVE} other {connexions PVE}} : {root} en root, {sudo} avec un utilisateur dédié et sudo, {plain} avec un utilisateur dédié sans sudo."
      },
      "recs": {
        "heading": "Recommandations de sécurité",
        "intro": "Pour un lab ou un environnement mono-administrateur, root est acceptable si la clé SSH est bien gérée. En production, en multi-administrateurs ou avec des enjeux de conformité, un utilisateur dédié avec sudo est recommandé : vous obtenez un journal d'audit dans /var/log/auth.log et une compromission est bornée aux commandes whitelistées.",
        "step1Title": "Créer un utilisateur SSH dédié sur chaque nœud PVE",
        "step1Hint": "Exécuter ces commandes sur chaque nœud PVE (adapter la clé publique à la vôtre).",
        "step2Title": "Installer le modèle sudoers",
        "step2Hint": "Copier le modèle, le coller dans /etc/sudoers.d/proxcenter sur chaque nœud, puis valider avec visudo -c.",
        "step3Title": "Basculer la connexion ProxCenter vers le nouvel utilisateur",
        "step3Hint": "Dans Réglages > Connexions > PVE, éditer chaque connexion, changer l'utilisateur SSH vers proxcenter et activer Use sudo.",
        "copyTemplate": "Copier le modèle sudoers",
        "copyInstall": "Copier la commande d'installation",
        "copied": "Copié dans le presse-papiers",
        "disclaimer": "Remarque : la whitelist de commandes est appliquée lorsque les commandes passent par l'orchestrateur embarqué. Certains chemins (migrations, opérations nœud directes) contournent cette vérification aujourd'hui. Un chantier de durcissement est suivi séparément ; exécuter ProxCenter sous un utilisateur dédié avec sudo fournit déjà un journal d'audit système (/var/log/auth.log) et limite l'impact d'une compromission.",
        "shellWrapWarning": "Quelques commandes utilisent des constructions shell (boucles sur les bridges OVS) qui ne peuvent pas être exprimées comme de simples règles sudoers exec. Le modèle inclut une entrée /bin/sh pour ces cas. Si vous préférez éviter /bin/sh dans sudoers, n'utilisez pas la fonctionnalité de configuration sFlow des Network Flows."
      },
      "allowlist": {
        "heading": "Liste des commandes autorisées",
        "searchPlaceholder": "Filtrer les commandes…",
        "columnPrefix": "Commande",
        "columnPurpose": "Usage",
        "columnUsedBy": "Utilisée par",
        "noResults": "Aucune commande ne correspond à votre recherche.",
        "loading": "Chargement de la liste…",
        "categoryCount": "{count} {count, plural, one {commande} other {commandes}}"
      },
      "errors": {
        "fetchFailed": "Impossible de charger la liste des commandes SSH.",
        "clipboardFailed": "Impossible de copier dans le presse-papiers.",
        "retry": "Réessayer"
      }
    },
```

- [ ] **Step 2: Add German translations**

Open `/root/saas/proxcenter-frontend/frontend/src/messages/de.json`, same placement. Insert:

```json
    "sshCommands": {
      "tabLabel": "SSH-Befehle",
      "page": {
        "title": "SSH-Befehle, die auf Ihren Knoten ausgeführt werden",
        "subtitle": "Vollständige Liste der Befehle, die ProxCenter über SSH ausführt, nach Verwendungszweck gruppiert, mit einer sudoers-Vorlage zum Betrieb unter einem dedizierten Benutzer."
      },
      "status": {
        "heading": "Ihre PVE-Verbindungen",
        "loading": "Verbindungen werden geladen…",
        "noConnections": "Noch keine PVE-Verbindung konfiguriert.",
        "rootWarning": "Alle Verbindungen verwenden root. Ein dedizierter Benutzer mit sudo liefert ein Audit-Log und begrenzt den Schaden einer Kompromittierung.",
        "partial": "Teilweise gehärtet: Einige Verbindungen verwenden noch root.",
        "hardened": "Gehärtet: Alle Verbindungen verwenden einen dedizierten Benutzer mit sudo.",
        "chipRoot": "Alles root",
        "chipPartial": "Teilweise gehärtet",
        "chipHardened": "Gehärtet",
        "summary": "{total} {total, plural, one {PVE-Verbindung} other {PVE-Verbindungen}}: {root} mit root, {sudo} mit dediziertem Benutzer und sudo, {plain} mit dediziertem Benutzer ohne sudo."
      },
      "recs": {
        "heading": "Sicherheitsempfehlungen",
        "intro": "Für Labor- oder Einzelbetreiber-Setups ist root akzeptabel, sofern der SSH-Schlüssel ordentlich verwaltet wird. Für Produktion, Mehrbenutzer- oder Compliance-sensitive Umgebungen wird ein dedizierter Benutzer mit sudo empfohlen: Sie erhalten ein Audit-Log in /var/log/auth.log und der Schaden einer Kompromittierung bleibt auf die erlaubten Befehle begrenzt.",
        "step1Title": "Dedizierten SSH-Benutzer auf jedem PVE-Knoten anlegen",
        "step1Hint": "Diese Befehle auf jedem PVE-Knoten ausführen (öffentlichen Schlüssel anpassen).",
        "step2Title": "sudoers-Vorlage installieren",
        "step2Hint": "Vorlage kopieren, in /etc/sudoers.d/proxcenter auf jedem Knoten einfügen und mit visudo -c prüfen.",
        "step3Title": "ProxCenter-Verbindung auf den neuen Benutzer umstellen",
        "step3Hint": "Unter Einstellungen > Verbindungen > PVE jede Verbindung bearbeiten, SSH-Benutzer auf proxcenter setzen und Use sudo aktivieren.",
        "copyTemplate": "sudoers-Vorlage kopieren",
        "copyInstall": "Installationsbefehl kopieren",
        "copied": "In Zwischenablage kopiert",
        "disclaimer": "Hinweis: Die Befehls-Allowlist wird angewendet, wenn Befehle über den eingebetteten Orchestrator laufen. Einige Pfade (Migrationen, direkte Knotenoperationen) umgehen diese Prüfung heute. Eine Härtung wird separat verfolgt; ProxCenter unter einem dedizierten Benutzer mit sudo zu betreiben liefert bereits ein Betriebssystem-Audit-Log (/var/log/auth.log) und begrenzt den Schaden einer Kompromittierung.",
        "shellWrapWarning": "Einige Befehle verwenden Shell-Konstrukte (z. B. for-Schleifen über OVS-Bridges), die sich nicht als einfache sudoers-Exec-Regeln ausdrücken lassen. Die Vorlage enthält dafür einen /bin/sh-Eintrag. Wer /bin/sh in sudoers vermeiden möchte, sollte die sFlow-Konfiguration in Network Flows nicht verwenden."
      },
      "allowlist": {
        "heading": "Befehls-Allowlist",
        "searchPlaceholder": "Befehle filtern…",
        "columnPrefix": "Befehl",
        "columnPurpose": "Zweck",
        "columnUsedBy": "Verwendet von",
        "noResults": "Kein Befehl entspricht Ihrer Suche.",
        "loading": "Allowlist wird geladen…",
        "categoryCount": "{count} {count, plural, one {Befehl} other {Befehle}}"
      },
      "errors": {
        "fetchFailed": "SSH-Befehlsliste konnte nicht geladen werden.",
        "clipboardFailed": "Kopieren in die Zwischenablage fehlgeschlagen.",
        "retry": "Erneut versuchen"
      }
    },
```

- [ ] **Step 3: Add Chinese translations**

Open `/root/saas/proxcenter-frontend/frontend/src/messages/zh-CN.json`. Insert:

```json
    "sshCommands": {
      "tabLabel": "SSH 命令",
      "page": {
        "title": "在节点上执行的 SSH 命令",
        "subtitle": "ProxCenter 通过 SSH 运行的完整命令列表，按用途分组，并附带可在专用用户下运行的 sudoers 模板。"
      },
      "status": {
        "heading": "您的 PVE 连接",
        "loading": "正在加载连接……",
        "noConnections": "尚未配置任何 PVE 连接。",
        "rootWarning": "所有连接都使用 root。建议切换到带 sudo 的专用用户，可获得审计日志并缩小被攻破时的影响面。",
        "partial": "部分加固：部分连接仍使用 root。",
        "hardened": "已加固：所有连接都使用带 sudo 的专用用户。",
        "chipRoot": "全部 root",
        "chipPartial": "部分加固",
        "chipHardened": "已加固",
        "summary": "{total} 个 PVE 连接：{root} 个使用 root，{sudo} 个使用带 sudo 的专用用户，{plain} 个使用不带 sudo 的专用用户。"
      },
      "recs": {
        "heading": "安全建议",
        "intro": "对于实验室或单管理员环境，只要 SSH 密钥管理得当，使用 root 是可以接受的。在生产、多管理员或有合规要求的环境中，建议使用带 sudo 的专用用户：您会在 /var/log/auth.log 中获得审计日志，被攻破时影响仅限于白名单命令。",
        "step1Title": "在每个 PVE 节点上创建专用 SSH 用户",
        "step1Hint": "在每个 PVE 节点上运行这些命令（请替换为您自己的公钥）。",
        "step2Title": "安装 sudoers 模板",
        "step2Hint": "复制模板，粘贴到每个节点的 /etc/sudoers.d/proxcenter，并使用 visudo -c 校验。",
        "step3Title": "将 ProxCenter 连接切换到新用户",
        "step3Hint": "在 设置 > 连接 > PVE 中，编辑每个连接，将 SSH 用户改为 proxcenter，并启用 Use sudo。",
        "copyTemplate": "复制 sudoers 模板",
        "copyInstall": "复制安装命令",
        "copied": "已复制到剪贴板",
        "disclaimer": "说明：命令白名单仅在命令经由内置编排器转发时生效。目前部分路径（迁移、节点直连操作）会绕过该检查。扩大严格校验范围的加固任务在另一个工单中跟进；使用带 sudo 的专用用户运行 ProxCenter 已经可以提供操作系统级审计日志（/var/log/auth.log），并缩小被攻破时的影响。",
        "shellWrapWarning": "部分命令使用了 shell 结构（例如针对 OVS 网桥的 for 循环），无法表示为简单的 sudoers exec 规则。模板为此包含了 /bin/sh 条目。如果希望避免在 sudoers 中出现 /bin/sh，请不要使用 Network Flows 的 sFlow 配置功能。"
      },
      "allowlist": {
        "heading": "命令白名单",
        "searchPlaceholder": "筛选命令……",
        "columnPrefix": "命令",
        "columnPurpose": "用途",
        "columnUsedBy": "使用者",
        "noResults": "没有命令与您的搜索匹配。",
        "loading": "正在加载白名单……",
        "categoryCount": "{count} 条命令"
      },
      "errors": {
        "fetchFailed": "加载 SSH 命令列表失败。",
        "clipboardFailed": "复制到剪贴板失败。",
        "retry": "重试"
      }
    },
```

- [ ] **Step 4: Validate JSON**

```bash
cd /root/saas/proxcenter-frontend/frontend && node -e "for (const f of ['en','fr','de','zh-CN']) JSON.parse(require('fs').readFileSync('src/messages/'+f+'.json','utf8')); console.log('ok')"
```

Expected: `ok`.

- [ ] **Step 5: Commit (ask user first)**

```bash
cd /root/saas/proxcenter-frontend && git add frontend/src/messages/fr.json frontend/src/messages/de.json frontend/src/messages/zh-CN.json && git commit -m "i18n(settings/ssh-commands): fr, de, zh-CN translations"
```

---

## Task 10: End-to-end manual verification

**Why:** feature-level QA before declaring done. No build or test runs per project convention — the user manually exercises the feature.

**Files:** none (verification only).

- [ ] **Step 1: Start the dev servers if not already running**

Per existing project workflow — do not add a step, the user handles this.

- [ ] **Step 2: Execute the verification checklist**

The user walks through every item below and reports which pass / fail:

- Navigate to `/settings?tab=ssh-commands`. Tab is visible with `ri-terminal-line` icon and label "SSH Commands".
- Connection Status card shows a numeric summary matching the PVE connections in Settings > Connections. The coloured chip matches the state (warning if all root, info if mixed, success if all hardened).
- Allowlist card shows eight categories collapsed by default. Clicking expands them. Each row shows the command prefix monospaced, its description, and the module that uses it.
- Typing `ovs` in the search box filters down to one category (Network Flows) with 5 commands.
- Typing `migration` in the search box expands multiple categories and filters their rows.
- Typing `xyz-nonsense` shows the "No command matches your search" message.
- Security Recommendations card shows the three accordions. Step 1 bash block contains `usermod -aG openvswitch proxcenter` and a reconnect reminder comment. Step 2 shows the generated sudoers template and a warning about the shell-wrapped OVS command. "Copy sudoers template" and "Copy install command" both populate the clipboard and show the "Copied" toast for 2 seconds. Step 3 describes the three UI actions to switch a connection.
- Info disclaimer at the bottom is present and matches the spec text.
- Switch the UI language to Français / Deutsch / 中文 and verify every label is translated (no raw key like `settings.sshCommands.recs.heading` is leaking through).
- Test as a user without `CONNECTION_VIEW` permission — the proxy route `/api/v1/ssh/allowlist` returns a 403 / permission denied (the tab itself is still visible; RBAC is enforced at the API, not on the tab).
- Verify the raw backend endpoint: `curl http://<orchestrator>/api/v1/ssh/allowlist` returns `{"categories": [...]}` with 8 entries.

- [ ] **Step 3: When all items pass, the feature is done**

Close the loop on the GitHub issue: post a follow-up comment on adminsyspro/proxcenter-ui#267 (draft to be approved per `feedback_github_post_approval`) pointing `@nothing-fr` to the new tab.
