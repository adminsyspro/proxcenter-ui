// src/lib/xcpng/guest-os.ts
//
// The guest OS of a XAPI VM (XenServer, XCP-ng). The guest agent reports it in
// VM_guest_metrics.os_version, which is empty on a VM whose VM Tools were never
// installed or were removed before the migration: that VM used to be taken for
// Linux (ostype l26, VirtIO SCSI boot disk) and Windows then stopped with
// INACCESSIBLE_BOOT_DEVICE (partner report, XenServer 7.1, 11/2026). The VM
// record still says what it is: the template it was installed from
// (other_config.base_template_name, reference_label) and the viridian platform
// flag, which XAPI sets for Windows templates only.

export interface XenGuestOsInput {
  /** VM_guest_metrics.os_version (name, distro, ...), absent without a guest agent. */
  osVersion?: Record<string, string> | null
  /** VM.other_config (XO: vm.other). */
  otherConfig?: Record<string, string> | null
  /** VM.reference_label ("windows-server-2025"), XenServer 8 and XCP-ng 8.3. */
  referenceLabel?: string | null
  /** VM.platform.viridian ("true"), or XO's boolean vm.viridian. */
  viridian?: string | boolean | null
}

/** Guest OS name for the mapper: the agent's report first, then what the VM record says. */
export function xenGuestOs(a: XenGuestOsInput): string {
  const reported = a.osVersion?.name || a.osVersion?.distro
  if (reported) return reported
  const template = a.otherConfig?.base_template_name?.trim()
  if (template && !/^other install media$/i.test(template)) return template
  const label = a.referenceLabel?.trim()
  if (label) return label.replace(/[-_]+/g, " ")
  if (a.viridian === true || a.viridian === "true") return "Windows"
  return ""
}
