/**
 * Hyper-V client - uses WinRM to execute PowerShell commands
 * against a Windows Server running the Hyper-V role.
 *
 * Lists VMs, retrieves disk info (VHDX paths and sizes), and tests connectivity.
 */

import { WinRMClient, type WinRMConnection } from "./winrm"
import { hypervDiskMountPath } from "./diskPaths"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HyperVVm {
  vmId: string          // GUID
  name: string
  state: string         // Running, Off, Saved, Paused, Other
  cpuCount: number
  memoryMB: number
  diskSizeBytes: number
  diskPaths: string[]   // VHDX / VHD file paths (Windows paths on the host)
  /**
   * Same disks as seen from the Proxmox node once the connection's SMB share
   * is mounted at /mnt/hyperv (see lib/hyperv/diskPaths.ts). Relative to the
   * share's local path when it is known, basename otherwise.
   */
  diskMountPaths: string[]
  generation: number    // 1 or 2
}

export interface HyperVListOptions {
  /** SMB share name of the connection: its local path is resolved on the host to map disk paths. */
  shareName?: string | null
}

/** Facts the offline migration needs before copying a VM's disk files. */
export interface HyperVVmReadiness {
  state: string          // Running, Off, Saved, Paused, Other
  checkpointCount: number
}

/** Single-quote a value for interpolation inside a PowerShell string literal. */
function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class HyperVClient {
  private winrm: WinRMClient

  constructor(conn: WinRMConnection) {
    this.winrm = new WinRMClient(conn)
  }

  /**
   * Test the WinRM connection and verify Hyper-V is available.
   */
  async testConnection(): Promise<{ hostname: string; version: string }> {
    return this.winrm.testConnection()
  }

  /**
   * List all VMs on the Hyper-V host, including disk paths and sizes.
   *
   * ONE PowerShell invocation. Every remote command pays a powershell.exe
   * start plus the Hyper-V module import (several seconds each on Windows
   * Server 2019), so the VM list and the disk list are gathered in the same
   * script. Disk sizes come from the file size on disk (Get-Item), never from
   * Get-VHD: that cmdlet opens every VHDX and walks its parent chain, which
   * measured at 13 s for ~20 disks on a customer host and pushed the whole
   * listing past the inventory's client-side timeout. getVM() keeps Get-VHD
   * for the single VM about to be migrated, where the exact size matters.
   */
  async listVMs(options: HyperVListOptions = {}): Promise<HyperVVm[]> {
    const ps = `
      ${this.sharePathSnippet(options.shareName)}
      $out = @()
      foreach ($vm in Get-VM) {
        $disks = @()
        foreach ($hdd in Get-VMHardDiskDrive -VM $vm) {
          $size = 0
          try {
            $file = Get-Item -LiteralPath $hdd.Path -ErrorAction Stop
            $size = $file.Length
          } catch {}
          $disks += @{Path=$hdd.Path; SizeBytes=$size}
        }
        $out += @{
          VMId = $vm.VMId.ToString()
          Name = $vm.Name
          State = [int]$vm.State
          ProcessorCount = $vm.ProcessorCount
          MemoryMB = [math]::Round($vm.MemoryAssigned/1MB)
          MemoryStartupMB = [math]::Round($vm.MemoryStartup/1MB)
          DynamicMemoryMaxMB = [math]::Round($vm.MemoryMaximum/1MB)
          Generation = $vm.Generation
          Disks = $disks
        }
      }
      @{ SharePath = $sharePath; VMs = @($out) } | ConvertTo-Json -Compress -Depth 5
    `.trim()

    const raw = await this.winrm.execute(ps)
    const data = JSON.parse(raw.trim())
    const sharePath = typeof data?.SharePath === "string" ? data.SharePath : null

    return this.normalizeArray(data?.VMs).map((vm: any) => this.mapVm(vm, sharePath))
  }

  /**
   * Retrieve what decides whether the VM can be migrated offline: it must be
   * powered off (the disk files are copied as they are) and carry no
   * checkpoint (the active disk would be a differencing .avhdx whose parent
   * chain only resolves on the Windows host).
   */
  async getVmReadiness(vmId: string): Promise<HyperVVmReadiness> {
    this.assertVmId(vmId)
    const ps = `
      $vm = Get-VM -Id ${psQuote(vmId)}
      if (-not $vm) { throw "VM not found: ${vmId}" }
      @{
        State = [int]$vm.State
        CheckpointCount = @(Get-VMSnapshot -VM $vm -ErrorAction SilentlyContinue).Count
      } | ConvertTo-Json -Compress
    `.trim()

    const raw = await this.winrm.execute(ps)
    const data = JSON.parse(raw.trim())
    return {
      state: this.resolveVmState(data.State),
      checkpointCount: typeof data.CheckpointCount === "number" ? data.CheckpointCount : 0,
    }
  }

  /**
   * Get a single VM by its GUID, including disk info.
   */
  async getVM(vmId: string, options: HyperVListOptions = {}): Promise<HyperVVm> {
    this.assertVmId(vmId)

    const ps = `
      ${this.sharePathSnippet(options.shareName)}
      $vm = Get-VM -Id '${vmId}'
      if (-not $vm) { throw "VM not found: ${vmId}" }

      $disks = @()
      $hdds = Get-VMHardDiskDrive -VM $vm
      foreach ($hdd in $hdds) {
        $size = 0
        try {
          $vhd = Get-VHD -Path $hdd.Path -ErrorAction SilentlyContinue
          if ($vhd) { $size = $vhd.FileSize }
        } catch {}
        $disks += @{Path=$hdd.Path; SizeBytes=$size}
      }

      @{
        SharePath = $sharePath
        VMId = $vm.VMId.ToString()
        Name = $vm.Name
        State = $vm.State
        ProcessorCount = $vm.ProcessorCount
        MemoryMB = [math]::Round($vm.MemoryAssigned/1MB)
        MemoryStartupMB = [math]::Round($vm.MemoryStartup/1MB)
        DynamicMemoryMaxMB = [math]::Round($vm.MemoryMaximum/1MB)
        Generation = $vm.Generation
        Disks = $disks
      } | ConvertTo-Json -Compress -Depth 4
    `.trim()

    const raw = await this.winrm.execute(ps)
    const data = JSON.parse(raw.trim())
    const sharePath = typeof data?.SharePath === "string" ? data.SharePath : null

    return this.mapVm({ ...data, VMId: data.VMId || vmId }, sharePath)
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** Validate GUID format to prevent injection into the PowerShell script. */
  private assertVmId(vmId: string): void {
    if (!/^[0-9a-f-]{36}$/i.test(vmId)) {
      throw new Error(`Invalid VM ID format: ${vmId}`)
    }
  }

  /**
   * PowerShell prologue setting $sharePath to the local folder behind the
   * connection's SMB share (null when unknown). Resolved in the same remote
   * command as the VM query: every extra command costs a powershell.exe start.
   */
  private sharePathSnippet(shareName?: string | null): string {
    if (!shareName) return "$sharePath = $null"
    return `$sharePath = $null
      try { $sharePath = (Get-SmbShare -Name ${psQuote(shareName)} -ErrorAction Stop).Path } catch {}`
  }

  /** Map one VM object of the PowerShell output to HyperVVm. */
  private mapVm(vm: any, sharePath: string | null): HyperVVm {
    const vmId = vm?.VMId?.toString() || ""
    const diskEntries = this.normalizeArray(vm?.Disks || [])
    const diskPaths: string[] = diskEntries.map((d: any) => d?.Path).filter(Boolean)
    const diskSizeBytes = diskEntries.reduce(
      (sum: number, d: any) => sum + (typeof d?.SizeBytes === "number" ? d.SizeBytes : 0),
      0
    )

    // MemoryAssigned is 0 while the VM is off. The startup memory is what the
    // VM gets at boot and what a migration should size; the dynamic maximum
    // is a ceiling (1 TB by default on Hyper-V) and only a last resort.
    const memoryMB = (vm?.MemoryMB || 0) > 0
      ? vm.MemoryMB
      : (vm?.MemoryStartupMB || 0) > 0 ? vm.MemoryStartupMB : (vm?.DynamicMemoryMaxMB || 0)

    return {
      vmId,
      name: vm?.Name || "Unknown",
      state: this.resolveVmState(vm?.State),
      cpuCount: vm?.ProcessorCount || 0,
      memoryMB,
      diskSizeBytes,
      diskPaths,
      diskMountPaths: diskPaths.map(p => hypervDiskMountPath(p, sharePath)),
      generation: vm?.Generation || 1,
    }
  }

  /**
   * Normalize PS array that might be a single object.
   */
  private normalizeArray(val: any): any[] {
    if (!val) return []
    return Array.isArray(val) ? val : [val]
  }

  /**
   * Resolve PowerShell VM state enum to a human-readable string.
   * Get-VM State is an enum: Other=1, Running=2, Off=3, Stopping=4,
   * Saved=6, Paused=9, Starting=10, Reset=11, Saving=32773,
   * Pausing=32776, Resuming=32777, FastSaved=32779, FastSaving=32780
   */
  private resolveVmState(state: number | string): string {
    if (typeof state === "string") {
      // Already resolved by PS (some versions return the enum name)
      const known = ["Running", "Off", "Saved", "Paused", "Stopping", "Starting", "Reset", "Other"]
      if (known.includes(state)) return state
      // Try parsing as number
      const n = Number.parseInt(state, 10)
      if (!Number.isNaN(n)) return this.stateNumberToString(n)
      return state
    }

    return this.stateNumberToString(state)
  }

  private stateNumberToString(n: number): string {
    switch (n) {
      case 2: return "Running"
      case 3: return "Off"
      case 4: return "Stopping"
      case 6: return "Saved"
      case 9: return "Paused"
      case 10: return "Starting"
      case 11: return "Reset"
      case 32773: return "Saving"
      case 32776: return "Pausing"
      case 32777: return "Resuming"
      case 32779: return "FastSaved"
      case 32780: return "FastSaving"
      default: return "Other"
    }
  }
}
