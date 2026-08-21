import { describe, it, expect } from "vitest"
import {
  buildAmbiguousRootHint,
  chooseV2vRoot,
  formatRootCandidates,
  isSnapperSnapshotRoot,
  parseV2vRootPrompt,
  planV2vRootRetry,
  sanitizeV2vRoot,
  snapshotParentDevice,
} from "./v2v-root-select"

/**
 * Tail of the failed conversion from discussion #738. We only ever get a tail
 * of the log file, so the list is truncated (it starts at [4]), and the prompt
 * line uses typographic quotes exactly as virt-v2v prints them.
 */
const SNAPPER_ONLY_TAIL = [
  " [4] btrfsvol:/dev/system/root/@/.snapshots/316/snapshot (SUSE Linux Enterprise Server 15 SP6)",
  " [5] btrfsvol:/dev/system/root/@/.snapshots/317/snapshot (SUSE Linux Enterprise Server 15 SP6)",
  " [16] btrfsvol:/dev/system/root/@/.snapshots/328/snapshot (SUSE Linux Enterprise Server 15 SP7)",
  "",
  'Enter a number between 1 and 16, or ‘exit’: { "message": "exception: End_of_file", "timestamp": "2026-08-18T20:06:26.462686545+01:00", "type": "error" }',
  "virt-v2v: error: exception: End_of_file",
].join("\n")

/** Same prompt, but the live root device survived in the tail. */
const SNAPPER_WITH_REAL_ROOT = [
  " [1] /dev/system/root (SUSE Linux Enterprise Server 15 SP7)",
  " [2] btrfsvol:/dev/system/root/@/.snapshots/316/snapshot (SUSE Linux Enterprise Server 15 SP6)",
  " [3] btrfsvol:/dev/system/root/@/.snapshots/317/snapshot (SUSE Linux Enterprise Server 15 SP6)",
  " [4] btrfsvol:/dev/system/root/@/.snapshots/328/snapshot (SUSE Linux Enterprise Server 15 SP7)",
  "",
  "Enter a number between 1 and 4, or ‘exit’: ",
].join("\n")

/** Genuine dual boot: two operating systems, neither is a snapshot. */
const DUAL_BOOT_TAIL = [
  " [1] /dev/sda2 (Windows Server 2019 Standard)",
  " [2] /dev/vg0/root (Debian GNU/Linux 12)",
  "",
  "Enter a number between 1 and 2, or ‘exit’: ",
].join("\n")

/**
 * A log with no root prompt at all. It still contains bracketed numbered
 * lines: progress timestamps, and a `-v -x` style device listing that has the
 * same visual shape as prompt entries. None of it may be mistaken for a
 * root prompt.
 */
const NO_PROMPT_LOG = [
  "[   0.0] Setting up the source: -i libvirt srv-app01",
  "[  12.3] Copying disk 1/2",
  "libguestfs: trace: list_filesystems",
  " [1] /dev/sda1 (Linux)",
  " [2] /dev/sda2 (swap)",
  "[ 250.8] Copying disk 2/2",
  "virt-v2v: error: could not write to the guest",
].join("\n")

describe("isSnapperSnapshotRoot", () => {
  it("classifies snapper snapshot subvolumes as snapshots", () => {
    expect(isSnapperSnapshotRoot("btrfsvol:/dev/system/root/@/.snapshots/316/snapshot")).toBe(true)
    expect(isSnapperSnapshotRoot("btrfsvol:/dev/system/root/@/.snapshots/328/snapshot")).toBe(true)
  })

  it("does not classify real devices or the live btrfs subvolume as snapshots", () => {
    expect(isSnapperSnapshotRoot("/dev/system/root")).toBe(false)
    expect(isSnapperSnapshotRoot("/dev/sda2")).toBe(false)
    expect(isSnapperSnapshotRoot("/dev/vg0/root")).toBe(false)
    expect(isSnapperSnapshotRoot("btrfsvol:/dev/system/root/@")).toBe(false)
  })
})

describe("sanitizeV2vRoot", () => {
  it("accepts plain devices, LVM paths and btrfs subvolume pseudo-paths", () => {
    expect(sanitizeV2vRoot("/dev/system/root")).toBe("/dev/system/root")
    expect(sanitizeV2vRoot("/dev/VG/LV")).toBe("/dev/VG/LV")
    expect(sanitizeV2vRoot("btrfsvol:/dev/system/root/@/.snapshots/328/snapshot")).toBe(
      "btrfsvol:/dev/system/root/@/.snapshots/328/snapshot"
    )
  })

  it("trims surrounding whitespace", () => {
    expect(sanitizeV2vRoot("  /dev/system/root\t")).toBe("/dev/system/root")
  })

  it("rejects missing or empty values", () => {
    expect(sanitizeV2vRoot(undefined)).toBeNull()
    expect(sanitizeV2vRoot(null)).toBeNull()
    expect(sanitizeV2vRoot("")).toBeNull()
    expect(sanitizeV2vRoot("   ")).toBeNull()
  })

  it("rejects shell-injection attempts", () => {
    expect(sanitizeV2vRoot("/dev/sda2; rm -rf /")).toBeNull()
    expect(sanitizeV2vRoot("$(whoami)")).toBeNull()
    expect(sanitizeV2vRoot("a b")).toBeNull()
    expect(sanitizeV2vRoot("`id`")).toBeNull()
    expect(sanitizeV2vRoot("/dev/sda2|true")).toBeNull()
    expect(sanitizeV2vRoot("/dev/sda2\n/dev/sdb")).toBeNull()
  })
})

describe("parseV2vRootPrompt", () => {
  it("parses every entry of the truncated #738 tail", () => {
    expect(parseV2vRootPrompt(SNAPPER_ONLY_TAIL)).toEqual([
      {
        index: 4,
        device: "btrfsvol:/dev/system/root/@/.snapshots/316/snapshot",
        description: "SUSE Linux Enterprise Server 15 SP6",
      },
      {
        index: 5,
        device: "btrfsvol:/dev/system/root/@/.snapshots/317/snapshot",
        description: "SUSE Linux Enterprise Server 15 SP6",
      },
      {
        index: 16,
        device: "btrfsvol:/dev/system/root/@/.snapshots/328/snapshot",
        description: "SUSE Linux Enterprise Server 15 SP7",
      },
    ])
  })

  it("classifies every #738 entry as a snapper snapshot", () => {
    const candidates = parseV2vRootPrompt(SNAPPER_ONLY_TAIL)
    expect(candidates).toHaveLength(3)
    for (const candidate of candidates) {
      expect(isSnapperSnapshotRoot(candidate.device)).toBe(true)
    }
  })

  it("returns [] when virt-v2v never asked, even with look-alike numbered lines", () => {
    // The guard is the prompt line, not the numbered entries: `-v -x` traces
    // and progress lines produce bracketed numbers in a very similar shape.
    expect(parseV2vRootPrompt(NO_PROMPT_LOG)).toEqual([])
    expect(parseV2vRootPrompt("")).toEqual([])
  })

  it("keeps each index once when the tail contains the list twice", () => {
    // Progress polling re-reads the tail, so the same block shows up again.
    const doubled = `${SNAPPER_ONLY_TAIL}\n${SNAPPER_ONLY_TAIL}`
    const candidates = parseV2vRootPrompt(doubled)
    expect(candidates.map(c => c.index)).toEqual([4, 5, 16])
  })

  it("handles CRLF line endings and entries without a description", () => {
    const log = [
      " [1] /dev/sda2 (Windows Server 2019 Standard)",
      " [2] /dev/sdb1",
      "",
      "Enter a number between 1 and 2, or ‘exit’: ",
    ].join("\r\n")
    expect(parseV2vRootPrompt(log)).toEqual([
      { index: 1, device: "/dev/sda2", description: "Windows Server 2019 Standard" },
      { index: 2, device: "/dev/sdb1", description: "" },
    ])
  })

  it("drops a candidate whose device carries a shell metacharacter", () => {
    const log = [
      " [1] /dev/sda2 (Windows Server 2019 Standard)",
      " [2] $(whoami) (Evil)",
      " [3] /dev/sda9;reboot (Also evil)",
      "",
      "Enter a number between 1 and 3, or ‘exit’: ",
    ].join("\n")
    expect(parseV2vRootPrompt(log)).toEqual([
      { index: 1, device: "/dev/sda2", description: "Windows Server 2019 Standard" },
    ])
  })

  it("parses a description containing nested parentheses", () => {
    const log = [
      " [1] /dev/system/root (SUSE Linux Enterprise Server 15 SP7)",
      " [2] /dev/sda2 (Debian GNU/Linux 12 (bookworm))",
      "",
      "Enter a number between 1 and 2, or ‘exit’: ",
    ].join("\n")
    expect(parseV2vRootPrompt(log)).toEqual([
      { index: 1, device: "/dev/system/root", description: "SUSE Linux Enterprise Server 15 SP7" },
      { index: 2, device: "/dev/sda2", description: "Debian GNU/Linux 12 (bookworm)" },
    ])
    expect(chooseV2vRoot(log).kind).toBe("ambiguous")
  })
})

describe("chooseV2vRoot", () => {
  it("stays ambiguous on the #738 tail where every candidate is a snapshot", () => {
    const choice = chooseV2vRoot(SNAPPER_ONLY_TAIL)
    expect(choice.kind).toBe("ambiguous")
    if (choice.kind !== "ambiguous") return
    expect(choice.candidates).toHaveLength(3)
    expect(choice.candidates.map(c => c.index)).toEqual([4, 5, 16])
  })

  it("selects the single non-snapshot root among snapper snapshots", () => {
    const choice = chooseV2vRoot(SNAPPER_WITH_REAL_ROOT)
    expect(choice.kind).toBe("selected")
    if (choice.kind !== "selected") return
    expect(choice.device).toBe("/dev/system/root")
    // The full candidate list (snapshots included) is kept for the job log.
    expect(choice.candidates).toHaveLength(4)
  })

  it("never auto-picks on a genuine dual boot", () => {
    const choice = chooseV2vRoot(DUAL_BOOT_TAIL)
    expect(choice.kind).toBe("ambiguous")
    if (choice.kind !== "ambiguous") return
    expect(choice.candidates.map(c => c.device)).toEqual(["/dev/sda2", "/dev/vg0/root"])
  })

  it("returns not-asked when the log has no root prompt", () => {
    expect(chooseV2vRoot(NO_PROMPT_LOG)).toEqual({ kind: "not-asked" })
    expect(chooseV2vRoot("")).toEqual({ kind: "not-asked" })
  })
})

describe("formatRootCandidates", () => {
  it("renders one indented line per candidate, parentheses only when described", () => {
    const rendered = formatRootCandidates([
      { index: 1, device: "/dev/sda2", description: "Windows Server 2019 Standard" },
      { index: 2, device: "/dev/sdb1", description: "" },
    ])
    expect(rendered).toBe("  [1] /dev/sda2 (Windows Server 2019 Standard)\n  [2] /dev/sdb1")
  })
})

describe("buildAmbiguousRootHint", () => {
  const snapshots = parseV2vRootPrompt(SNAPPER_ONLY_TAIL)

  it("lists only the plausible roots and counts the ignored snapshots", () => {
    const hint = buildAmbiguousRootHint([
      { index: 1, device: "/dev/sda2", description: "Windows Server 2019 Standard" },
      { index: 2, device: "/dev/vg0/root", description: "Debian GNU/Linux 12" },
      ...snapshots,
    ])
    expect(hint).toContain("[1] /dev/sda2 (Windows Server 2019 Standard)")
    expect(hint).toContain("[2] /dev/vg0/root (Debian GNU/Linux 12)")
    expect(hint).toContain("2 of them could be the system to convert")
    expect(hint).toContain("3 of them are btrfs/snapper snapshot subvolumes and were ignored")
    // The snapshot subvolumes themselves must not be offered as values.
    expect(hint).not.toContain("btrfsvol:")
  })

  it("lists every candidate when all of them are snapshots", () => {
    const hint = buildAmbiguousRootHint(snapshots)
    expect(hint).toContain("every candidate looks like a snapshot subvolume")
    expect(hint).toContain("[4] btrfsvol:/dev/system/root/@/.snapshots/316/snapshot")
    expect(hint).toContain("[5] btrfsvol:/dev/system/root/@/.snapshots/317/snapshot")
    expect(hint).toContain("[16] btrfsvol:/dev/system/root/@/.snapshots/328/snapshot")
  })

  it("points at the migration dialog field for the retry", () => {
    const hint = buildAmbiguousRootHint(snapshots)
    expect(hint).toContain("Root filesystem")
  })
})

describe("planV2vRootRetry", () => {
  it("does nothing when the conversion succeeded", () => {
    // A successful run can still contain a prompt-looking line in verbose output
    expect(planV2vRootRetry({ failed: false, output: SNAPPER_WITH_REAL_ROOT })).toEqual({ action: "none" })
  })

  it("does nothing when the failure has no root prompt", () => {
    const log = "virt-v2v: error: libguestfs error: could not create appliance"
    expect(planV2vRootRetry({ failed: true, output: log })).toEqual({ action: "none" })
  })

  it("retries with the single non-snapshot root and logs what it picked", () => {
    const plan = planV2vRootRetry({ failed: true, output: SNAPPER_WITH_REAL_ROOT })
    expect(plan.action).toBe("retry")
    if (plan.action !== "retry") return
    expect(plan.device).toBe("/dev/system/root")
    expect(plan.logs[0]).toContain("stopped to ask which root filesystem")
    expect(plan.logs[0]).toContain("/dev/system/root")
    expect(plan.logs[1]).toContain("Retrying the conversion with --root")
  })

  it("asks the user instead of guessing when every candidate is a snapshot", () => {
    const plan = planV2vRootRetry({ failed: true, output: SNAPPER_ONLY_TAIL })
    expect(plan.action).toBe("hint")
    if (plan.action !== "hint") return
    expect(plan.hint).toContain("Root filesystem")
    expect(plan.logs).toHaveLength(1)
  })

  it("never second-guesses a root the user pinned", () => {
    // Retrying with another root would convert a different system than the one
    // the operator asked for, so a pinned root always fails loudly instead.
    const plan = planV2vRootRetry({
      failed: true,
      output: SNAPPER_WITH_REAL_ROOT,
      pinnedRoot: "/dev/sda2",
    })
    expect(plan).toEqual({ action: "none" })
  })
})

describe("snapshot parent device", () => {
  it("extracts the device a snapper snapshot lives on", () => {
    expect(snapshotParentDevice("btrfsvol:/dev/system/root/@/.snapshots/328/snapshot")).toBe("/dev/system/root")
    // layouts without the @ prefix exist too
    expect(snapshotParentDevice("btrfsvol:/dev/sda2/.snapshots/3/snapshot")).toBe("/dev/sda2")
  })

  it("returns null for anything that is not a snapshot subvolume", () => {
    expect(snapshotParentDevice("/dev/system/root")).toBeNull()
    expect(snapshotParentDevice("btrfsvol:/dev/system/root/@/home")).toBeNull()
  })

  it("refuses to pick a lone non-snapshot root that is not the snapshots' device", () => {
    // A stale system disk from an older install, next to a snapper system: the
    // only non-snapshot candidate is the WRONG one, so this must stay ambiguous
    const log = [
      " [1] /dev/sdb1 (CentOS Linux 7)",
      " [2] btrfsvol:/dev/system/root/@/.snapshots/327/snapshot (SUSE Linux Enterprise Server 15 SP7)",
      " [3] btrfsvol:/dev/system/root/@/.snapshots/328/snapshot (SUSE Linux Enterprise Server 15 SP7)",
      "",
      "Enter a number between 1 and 3, or \u2018exit\u2019: ",
    ].join("\n")
    expect(chooseV2vRoot(log).kind).toBe("ambiguous")
    expect(planV2vRootRetry({ failed: true, output: log }).action).toBe("hint")
  })

  it("still selects the parent device when it is present alongside its snapshots", () => {
    const log = [
      " [1] /dev/system/root (SUSE Linux Enterprise Server 15 SP7)",
      " [2] btrfsvol:/dev/system/root/@/.snapshots/328/snapshot (SUSE Linux Enterprise Server 15 SP7)",
      "",
      "Enter a number between 1 and 2, or \u2018exit\u2019: ",
    ].join("\n")
    const choice = chooseV2vRoot(log)
    expect(choice.kind).toBe("selected")
    if (choice.kind !== "selected") return
    expect(choice.device).toBe("/dev/system/root")
  })
})

describe("device names that drift inside the libguestfs appliance", () => {
  // Measured 2026-08-19 on a two-disk guest: virt-v2v reported the btrfs root as
  // /dev/sdb but its own subvolumes as btrfsvol:/dev/sdc/... A rule based only on
  // the parent device would refuse to pick the single plausible root.
  const skewed = (rootDesc: string, snapDesc: string) => [
    ` [1] /dev/sda (${rootDesc})`,
    ` [2] btrfsvol:/dev/sdb/.snapshots/1/snapshot (${snapDesc})`,
    ` [3] btrfsvol:/dev/sdb/.snapshots/2/snapshot (${snapDesc})`,
    "",
    "Enter a number between 1 and 3, or \u2018exit\u2019: ",
  ].join("\n")

  it("selects the lone root when every candidate describes the same system", () => {
    const choice = chooseV2vRoot(skewed("13.3", "13.3"))
    expect(choice.kind).toBe("selected")
    if (choice.kind !== "selected") return
    expect(choice.device).toBe("/dev/sda")
  })

  it("stays ambiguous when the lone root describes a different system", () => {
    // stale CentOS system disk sitting next to a snapper system: the only
    // non-snapshot candidate is the wrong one
    expect(chooseV2vRoot(skewed("CentOS Linux 7", "SUSE Linux Enterprise Server 15 SP7")).kind)
      .toBe("ambiguous")
  })

  it("stays ambiguous when descriptions are missing, rather than guessing", () => {
    const log = [
      " [1] /dev/sda",
      " [2] btrfsvol:/dev/sdb/.snapshots/1/snapshot",
      "",
      "Enter a number between 1 and 2, or \u2018exit\u2019: ",
    ].join("\n")
    expect(chooseV2vRoot(log).kind).toBe("ambiguous")
  })
})
