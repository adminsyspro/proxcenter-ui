/**
 * Pure CBT eligibility check, dependency-free so client components (e.g. the
 * migrate dialog's pre-launch fallback warning) can import it. cbt.ts
 * transitively pulls in the server-only SOAP client and re-exports these for
 * its existing server-side callers.
 */

export interface CbtEligibilityInput { hwVersion: string; disks: { diskMode?: string; sharing?: string }[] }

/** Pure eligibility check: CBT needs hw version >= 7 and no independent / multi-writer disks. */
export function cbtEligibility(vm: CbtEligibilityInput): { eligible: boolean; reason?: string } {
  const ver = Number.parseInt(vm.hwVersion.replace("vmx-", ""), 10) || 0
  if (ver < 7) return { eligible: false, reason: `hardware version ${vm.hwVersion} is below vmx-07` }
  for (const d of vm.disks) {
    if ((d.diskMode || "").includes("independent")) return { eligible: false, reason: "independent disk present" }
    if (d.sharing === "sharingMultiWriter") return { eligible: false, reason: "multi-writer disk present" }
  }
  return { eligible: true }
}
