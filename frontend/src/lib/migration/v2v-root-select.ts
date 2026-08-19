/**
 * Root filesystem selection for virt-v2v conversions.
 *
 * virt-v2v is INTERACTIVE by default: since 0.7.2 the default is `--root ask`,
 * so when guest inspection finds more than one bootable root it prints a
 * numbered list of candidates and waits for an answer on stdin. We launch
 * virt-v2v in the background with no console attached, so it reads end-of-file
 * instead of an answer and dies with
 * `virt-v2v: error: exception: End_of_file` (discussion #738).
 *
 * This is NOT limited to genuine dual-boot guests. A SLES/openSUSE guest using
 * btrfs + snapper is multi-root by construction: every snapshot subvolume
 * (`btrfsvol:/dev/system/root/@/.snapshots/N/snapshot`) inspects as a separate
 * operating system. The #738 guest listed 16 candidates for a single installed
 * system, and deleting snapshots on the source is not a workaround because the
 * active snapshot still inspects as a second root.
 *
 * Strategy: let virt-v2v itself enumerate the candidates (its inspection is the
 * only one guaranteed to match the conversion), parse the prompt, drop the
 * snapper snapshot subvolumes, then retry with an explicit `--root <device>`.
 *
 * We deliberately never fall back to `--root first`: the virt-v2v manual states
 * the root ordering is not meaningful, and converting a read-only snapshot
 * subvolume would inject the virtio drivers and rebuild the initramfs in the
 * wrong place, producing a VM that does not boot. When the choice stays
 * ambiguous we fail with the candidate list instead of guessing.
 */

/** One entry of virt-v2v's "which root do you want to convert" prompt. */
export interface V2vRootCandidate {
  /** 1-based index virt-v2v printed in front of the entry. */
  index: number
  /** Device or btrfs subvolume, e.g. `/dev/system/root`. */
  device: string
  /** Human description virt-v2v put in parentheses, e.g. the OS product name. */
  description: string
}

export type V2vRootChoice =
  /** virt-v2v did not ask anything: the failure has another cause. */
  | { kind: "not-asked" }
  /** Exactly one non-snapshot root: safe to retry with `--root <device>`. */
  | { kind: "selected"; device: string; candidates: V2vRootCandidate[] }
  /** Several (or zero) plausible roots: the user has to pick one. */
  | { kind: "ambiguous"; candidates: V2vRootCandidate[] }

/**
 * Signature of virt-v2v's root prompt. Matched on the prompt line rather than
 * the numbered entries alone, because a numbered list also appears in unrelated
 * virt-v2v output (`-v` traces list devices the same way). The closing quote is
 * a typographic one in real output (`or ‘exit’`), so we stop before it.
 */
const ROOT_PROMPT_RE = /Enter a number between 1 and (\d+)/

/**
 * ` [4] btrfsvol:/dev/system/root/@/.snapshots/316/snapshot (SUSE Linux ...)`
 *
 * Everything after the device is taken as the description without trying to
 * balance parentheses: the descriptions come from the guest's os-release
 * PRETTY_NAME and legitimately nest them (`Debian GNU/Linux 12 (bookworm)`).
 * A stricter pattern silently DROPPED such a candidate, which is the dangerous
 * direction: losing one root out of a genuine dual boot turns the ambiguous
 * case into an automatic selection of the other OS.
 */
const ROOT_ENTRY_RE = /^\s*\[(\d+)\]\s+(\S+)(.*)$/

/**
 * Snapper snapshot subvolumes. Never a valid conversion target: they are
 * read-only point-in-time copies, and the live system is reached through the
 * parent device (which mounts the default subvolume).
 */
const SNAPPER_SNAPSHOT_RE = /^btrfsvol:\/[^\s]*\/\.snapshots\/\d+\/snapshot$/

/**
 * Device names we are willing to put on a shell command line. virt-v2v root
 * names are device paths (`/dev/sda2`, `/dev/VG/LV`) or btrfs subvolume
 * pseudo-paths (`btrfsvol:/dev/system/root/@/.snapshots/328/snapshot`), so this
 * character class is generous enough while keeping shell metacharacters out.
 * Belt and braces: callers also shell-escape the value.
 */
const SAFE_ROOT_RE = /^[A-Za-z0-9:@/._+-]{1,255}$/

/**
 * Device a snapper snapshot subvolume lives on:
 * `btrfsvol:/dev/system/root/@/.snapshots/328/snapshot` -> `/dev/system/root`.
 * Null when the name is not a snapshot subvolume.
 */
const SNAPPER_PARENT_RE = /^btrfsvol:(\/[^\s]*?)(?:\/@)?\/\.snapshots\/\d+\/snapshot$/

export function isSnapperSnapshotRoot(device: string): boolean {
  return SNAPPER_SNAPSHOT_RE.test(device)
}

export function snapshotParentDevice(device: string): string | null {
  return SNAPPER_PARENT_RE.exec(device)?.[1] ?? null
}

/**
 * Reject anything that does not look like a device/subvolume name. Applied to
 * both the value parsed out of virt-v2v output and any user-supplied override,
 * so a hostile or malformed value can never reach the SSH command string.
 */
export function sanitizeV2vRoot(value: string | undefined | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!SAFE_ROOT_RE.test(trimmed)) return null
  return trimmed
}

/**
 * Extract the root candidates from a virt-v2v log. Returns an empty array when
 * virt-v2v never asked (no prompt line), so callers can tell "multi-boot
 * prompt" apart from every other conversion failure.
 */
export function parseV2vRootPrompt(output: string): V2vRootCandidate[] {
  if (!output || !ROOT_PROMPT_RE.test(output)) return []
  const candidates: V2vRootCandidate[] = []
  const seen = new Set<number>()
  for (const line of output.split("\n")) {
    const m = ROOT_ENTRY_RE.exec(line.replace(/\r$/, ""))
    if (!m) continue
    const index = Number(m[1])
    const device = m[2]
    // The log we get is a tail of the file, so the same numbered list can show
    // up twice (progress polling re-reads it). Keep the first occurrence.
    if (seen.has(index)) continue
    if (!sanitizeV2vRoot(device)) continue
    seen.add(index)
    // Strip the wrapping parentheses when they wrap the whole description, keep
    // the text as-is otherwise (a log line cut mid-description stays readable).
    const rest = (m[3] || "").trim()
    const description = rest.length > 1 && rest.startsWith("(") && rest.endsWith(")")
      ? rest.slice(1, -1).trim()
      : rest
    candidates.push({ index, device, description })
  }
  return candidates.sort((a, b) => a.index - b.index)
}

/**
 * Decide which root to convert from a failed virt-v2v run.
 *
 * `selected` is only returned when exactly one candidate survives the snapper
 * filter, which is the whole SLES/openSUSE snapshot class. A genuine dual-boot
 * guest stays `ambiguous` on purpose: picking an OS for the user could convert
 * the wrong system.
 */
export function chooseV2vRoot(output: string): V2vRootChoice {
  const candidates = parseV2vRootPrompt(output)
  if (candidates.length === 0) return { kind: "not-asked" }
  const realRoots = candidates.filter(c => !isSnapperSnapshotRoot(c.device))
  if (realRoots.length !== 1) return { kind: "ambiguous", candidates }
  const device = realRoots[0].device
  // Second condition, so "one non-snapshot root" is not enough on its own: the
  // root must belong to the same system as the snapshots. A guest carrying a
  // stale system disk from another install alongside a snapper system would
  // otherwise leave exactly one non-snapshot candidate, the wrong one, and we
  // would convert the stale disk.
  //
  // Two ways to establish that link, because device names alone are not reliable:
  //  1. the root IS the device the snapshots live on (single-disk guests);
  //  2. failing that, everyone describes the same operating system.
  //
  // Measured on 2026-08-19: with several disks attached, libguestfs reported the
  // btrfs root as /dev/sdb while its own subvolumes came back as
  // btrfsvol:/dev/sdc/..., so requiring (1) alone would refuse to pick the only
  // plausible root on a multi-disk guest. LVM names (/dev/system/root) do not
  // drift that way, plain /dev/sdX names do.
  const snapshots = candidates.filter(c => isSnapperSnapshotRoot(c.device))
  const parents = new Set(
    snapshots
      .map(c => snapshotParentDevice(c.device))
      .filter((p): p is string => p !== null),
  )
  if (parents.size === 0 || (parents.size === 1 && parents.has(device))) {
    return { kind: "selected", device, candidates }
  }
  const description = realRoots[0].description
  if (description && snapshots.every(c => c.description === description)) {
    return { kind: "selected", device, candidates }
  }
  return { kind: "ambiguous", candidates }
}

/**
 * The entries an operator may legitimately choose. Snapshot subvolumes are
 * dropped, unless they are all we have: then the choice is theirs to make on
 * the full list rather than being left with nothing.
 */
export function pickableRoots(candidates: V2vRootCandidate[]): V2vRootCandidate[] {
  const real = candidates.filter(c => !isSnapperSnapshotRoot(c.device))
  return real.length > 0 ? real : candidates
}

/** Render the candidate list for a job log or an error message. */
export function formatRootCandidates(candidates: V2vRootCandidate[]): string {
  return candidates
    .map(c => `  [${c.index}] ${c.device}${c.description ? ` (${c.description})` : ""}`)
    .join("\n")
}

/**
 * Actionable message for the ambiguous case. Lists what virt-v2v found and the
 * exact value to put in the migration dialog's "root filesystem" field so the
 * next attempt is non-interactive.
 */
export function buildAmbiguousRootHint(candidates: V2vRootCandidate[]): string {
  const realRoots = candidates.filter(c => !isSnapperSnapshotRoot(c.device))
  const snapshotCount = candidates.length - realRoots.length
  const listed = pickableRoots(candidates)
  const snapshotNote = snapshotCount > 0
    ? ` ${snapshotCount} of them are btrfs/snapper snapshot subvolumes and were ignored.`
    : ""
  const plural = realRoots.length === 0
    ? "every candidate looks like a snapshot subvolume, so none can be picked automatically"
    : `${realRoots.length} of them could be the system to convert, so none can be picked automatically`
  return "\n\nHint: guest inspection found several bootable root filesystems and " +
    `${plural}.${snapshotNote} ` +
    "Re-run the migration with the \"Root filesystem (advanced)\" field of the migration " +
    "dialog set to one of these exact values:\n" +
    `${formatRootCandidates(listed)}\n` +
    "Pick the system you want to migrate: the value is the device holding its root " +
    "filesystem, for example /dev/sda2 on a plain disk or /dev/system/root on LVM. " +
    "An entry under .snapshots/N/snapshot is a read-only snapshot and is never the " +
    "right target."
}

/**
 * What to do with a virt-v2v run that just failed, as far as root selection is
 * concerned. Kept here rather than in the pipeline so the decision (and its
 * branches) stay testable without an SSH session.
 */
export type V2vRootPlan =
  /** Nothing root-related to do: it succeeded, or it failed for another reason. */
  | { action: "none" }
  /** Retry the conversion with `--root device`. `logs` is for the job log. */
  | { action: "retry"; device: string; logs: string[] }
  /**
   * Cannot decide. `hint` is appended to the error if nobody picks, and
   * `candidates` are the systems an operator may choose from: the snapshot
   * subvolumes are already filtered out, so this is what the UI offers.
   */
  | { action: "hint"; hint: string; logs: string[]; candidates: V2vRootCandidate[] }

export function planV2vRootRetry(params: {
  /** Did the virt-v2v run fail? A successful run never needs a root decision. */
  failed: boolean
  /** Full virt-v2v log of the run. */
  output: string
  /**
   * Root already pinned by the user for this job. When set we do not second-guess
   * it: retrying with a different root would silently convert another system than
   * the one that was asked for.
   */
  pinnedRoot?: string | null
}): V2vRootPlan {
  if (!params.failed || params.pinnedRoot) return { action: "none" }
  const choice = chooseV2vRoot(params.output || "")
  if (choice.kind === "not-asked") return { action: "none" }
  const listing =
    `virt-v2v stopped to ask which root filesystem to convert. Guest inspection found ` +
    `${choice.candidates.length} candidate(s):\n${formatRootCandidates(choice.candidates)}`
  if (choice.kind === "selected") {
    return {
      action: "retry",
      device: choice.device,
      logs: [
        listing,
        `Selecting ${choice.device}: it is the only candidate that is not a btrfs/snapper ` +
        `snapshot subvolume. Retrying the conversion with --root.`,
      ],
    }
  }
  return {
    action: "hint",
    hint: buildAmbiguousRootHint(choice.candidates),
    logs: [listing],
    candidates: pickableRoots(choice.candidates),
  }
}
