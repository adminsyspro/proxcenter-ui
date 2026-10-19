import { soapGetGuestIdentities, type SoapSession } from "@/lib/vmware/soap"
import { cpuTooLowForEl10, el10CpuWarning, isEl10Guest, isEl10Inspection } from "./cpu-level"
import { MIGRATION_CPU_TYPE_DEFAULT } from "./cpu-type"

/**
 * Planning-time backstop of the dialog's EL10 rule (#1000), for every VMware
 * pipeline: an EL10 guest bound for a CPU type below x86-64-v3 is said in the
 * job log, hours before anyone wonders why the VM hangs at "Run /init". The
 * operator's choice is kept (the dialog already warned); this never throws.
 * Returns true when it warned.
 */
export async function warnIfEl10OnLowCpu(a: {
  session: SoapSession | null
  vmid: string
  guest: { guestId?: string; guestOS?: string }
  cpuType?: string
  log: (msg: string) => Promise<unknown>
}): Promise<boolean> {
  const cpuType = a.cpuType || MIGRATION_CPU_TYPE_DEFAULT
  if (!cpuTooLowForEl10(cpuType)) return false
  try {
    const reported = a.session ? (await soapGetGuestIdentities(a.session, [a.vmid])).get(a.vmid) : undefined
    const el10 = isEl10Guest({ ...a.guest, detailedData: reported?.detailedData })
      || (!!reported && isEl10Guest({ guestId: reported.guestId, guestOS: reported.guestOS }))
    if (!el10) return false
    await a.log(el10CpuWarning(cpuType))
    return true
  } catch {
    return false
  }
}

/** Same rule from virt-v2v's inspection output ("Converting … (redhat-based10.1) to run on KVM"). */
export function el10InspectionWarning(v2vOutput: string, cpuType?: string): string | null {
  const effective = cpuType || MIGRATION_CPU_TYPE_DEFAULT
  const line = /Converting (.+?) to run on KVM/.exec(v2vOutput)?.[0] ?? ""
  return line && isEl10Inspection(line) && cpuTooLowForEl10(effective) ? el10CpuWarning(effective) : null
}
