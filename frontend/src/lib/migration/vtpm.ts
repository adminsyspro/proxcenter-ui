// src/lib/migration/vtpm.ts
//
// vTPM awareness of the VMware (roadmap#1) and XAPI (roadmap#60) pipelines. A
// source with a virtual TPM gets an empty TPM 2.0 state on the target so
// Windows 11 / Server 2022 keep a TPM device; the TPM state itself (BitLocker
// keys, Windows Hello, measured boot) is never copied: vSphere keeps it in an
// encrypted .nvram, XAPI keeps it on the pool.

/** The `tpmstate0` value of `qm create`: a 4 MiB state volume, TPM 2.0. */
export function tpmstate0Param(targetStorage: string): string {
  return `${targetStorage}:1,version=v2.0`
}

const VTPM_KEEPER = { vsphere: "vSphere keeps it encrypted", xapi: "the pool keeps it" } as const

/** Preflight line of every pipeline when the source carries a vTPM. */
export function vtpmPreflightWarning(source: keyof typeof VTPM_KEEPER = "vsphere"): string {
  return (
    `Source VM has a virtual TPM. Its state is never copied (${VTPM_KEEPER[source]}): ` +
    "the target gets an empty TPM 2.0 (tpmstate0), so Windows 11 / Server 2022 keep a TPM device, " +
    "but BitLocker or Device Encryption will ask for the recovery key at first boot and Windows Hello / " +
    "TPM-bound certificates must be re-enrolled. Have the BitLocker recovery key at hand before the cutover."
  )
}

/** Log line once the target shell exists. */
export function vtpmCreatedLine(targetStorage: string): string {
  return `Empty TPM 2.0 state created on "${targetStorage}" (tpmstate0): the guest keeps a TPM device, with fresh keys`
}
