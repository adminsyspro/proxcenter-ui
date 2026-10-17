// src/lib/migration/vtpm.ts
//
// vTPM awareness of the VMware pipelines (roadmap#1). A source with a virtual
// TPM gets an empty TPM 2.0 state on the target so Windows 11 / Server 2022
// keep a TPM device; the TPM state itself (BitLocker keys, Windows Hello,
// measured boot) lives in vSphere's encrypted .nvram and is never copied.

/** The `tpmstate0` value of `qm create`: a 4 MiB state volume, TPM 2.0. */
export function tpmstate0Param(targetStorage: string): string {
  return `${targetStorage}:1,version=v2.0`
}

/** Preflight line of every pipeline when the source carries a vTPM. */
export function vtpmPreflightWarning(): string {
  return (
    "Source VM has a virtual TPM. Its state is never copied (vSphere keeps it encrypted): " +
    "the target gets an empty TPM 2.0 (tpmstate0), so Windows 11 / Server 2022 keep a TPM device, " +
    "but BitLocker or Device Encryption will ask for the recovery key at first boot and Windows Hello / " +
    "TPM-bound certificates must be re-enrolled. Have the BitLocker recovery key at hand before the cutover."
  )
}

/** Log line once the target shell exists. */
export function vtpmCreatedLine(targetStorage: string): string {
  return `Empty TPM 2.0 state created on "${targetStorage}" (tpmstate0): the guest keeps a TPM device, with fresh keys`
}
