/**
 * Hyper-V client - uses WinRM to execute PowerShell commands
 * against a Windows Server running the Hyper-V role.
 *
 * Lists VMs, retrieves disk info (VHDX paths and sizes), and tests connectivity.
 */

import { WinRMClient, type WinRMConnection } from "./winrm"

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
  diskPaths: string[]   // VHDX / VHD file paths
  generation: number    // 1 or 2
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
   * Executes two PowerShell commands:
   * 1. Get-VM for basic VM info
   * 2. For each VM, Get-VMHardDiskDrive + Get-VHD for disk details
   *
   * The disk info is gathered in a single batched PS call to avoid
   * N+1 round trips to the host.
   */
  async listVMs(): Promise<HyperVVm[]> {
    // Step 1: Get all VMs with basic info
    const vmPs = `
      $vms = Get-VM | Select-Object VMId, Name, State, ProcessorCount,
        @{N='MemoryMB';E={[math]::Round($_.MemoryAssigned/1MB)}},
        @{N='DynamicMemoryMaxMB';E={[math]::Round($_.MemoryMaximum/1MB)}},
        Generation
      if ($vms -eq $null) { '[]' } else { $vms | ConvertTo-Json -Compress }
    `.trim()

    const vmRaw = await this.winrm.execute(vmPs)
    const vmData = this.parseJsonArray(vmRaw)

    if (vmData.length === 0) return []

    // Step 2: Get disk info for all VMs in a single call
    // Build a PS script that collects disk paths + sizes per VM
    const diskPs = `
      $result = @{}
      foreach ($vm in Get-VM) {
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
        $result[$vm.VMId.ToString()] = $disks
      }
      $result | ConvertTo-Json -Compress -Depth 4
    `.trim()

    let diskMap: Record<string, Array<{ Path: string; SizeBytes: number }>> = {}
    try {
      const diskRaw = await this.winrm.execute(diskPs)
      const parsed = JSON.parse(diskRaw.trim())
      // PowerShell ConvertTo-Json wraps single-element arrays as objects,
      // and nested arrays may be objects too. Normalize carefully.
      diskMap = this.normalizeDiskMap(parsed)
    } catch {
      // If disk enumeration fails, we still return VMs without disk info
      // rather than failing the entire listing
    }

    return vmData.map((vm: any) => {
      const vmId = vm.VMId?.toString() || ""
      const diskEntries = diskMap[vmId] || []
      const diskPaths = diskEntries.map(d => d.Path).filter(Boolean)
      const diskSizeBytes = diskEntries.reduce((sum, d) => sum + (d.SizeBytes || 0), 0)

      // PowerShell State enum: Running=2, Off=3, Saved=6, Paused=9, etc.
      // ConvertTo-Json serializes it as an integer, but sometimes as string
      const state = this.resolveVmState(vm.State)

      // MemoryMB may be 0 if VM is off (MemoryAssigned = 0); fall back to max
      const memoryMB = (vm.MemoryMB || 0) > 0 ? vm.MemoryMB : (vm.DynamicMemoryMaxMB || 0)

      return {
        vmId,
        name: vm.Name || "Unknown",
        state,
        cpuCount: vm.ProcessorCount || 0,
        memoryMB,
        diskSizeBytes,
        diskPaths,
        generation: vm.Generation || 1,
      }
    })
  }

  /**
   * Get a single VM by its GUID, including disk info.
   */
  async getVM(vmId: string): Promise<HyperVVm> {
    // Validate GUID format to prevent injection
    if (!/^[0-9a-f-]{36}$/i.test(vmId)) {
      throw new Error(`Invalid VM ID format: ${vmId}`)
    }

    const ps = `
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
        VMId = $vm.VMId.ToString()
        Name = $vm.Name
        State = $vm.State
        ProcessorCount = $vm.ProcessorCount
        MemoryMB = [math]::Round($vm.MemoryAssigned/1MB)
        DynamicMemoryMaxMB = [math]::Round($vm.MemoryMaximum/1MB)
        Generation = $vm.Generation
        Disks = $disks
      } | ConvertTo-Json -Compress -Depth 4
    `.trim()

    const raw = await this.winrm.execute(ps)
    const data = JSON.parse(raw.trim())

    const diskEntries = this.normalizeArray(data.Disks || [])
    const diskPaths = diskEntries.map((d: any) => d.Path).filter(Boolean)
    const diskSizeBytes = diskEntries.reduce((sum: number, d: any) => sum + (d.SizeBytes || 0), 0)
    const memoryMB = (data.MemoryMB || 0) > 0 ? data.MemoryMB : (data.DynamicMemoryMaxMB || 0)

    return {
      vmId: data.VMId || vmId,
      name: data.Name || "Unknown",
      state: this.resolveVmState(data.State),
      cpuCount: data.ProcessorCount || 0,
      memoryMB,
      diskSizeBytes,
      diskPaths,
      generation: data.Generation || 1,
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Parse JSON that might be a single object (when PS has one result)
   * or an array. Always returns an array.
   */
  private parseJsonArray(raw: string): any[] {
    const trimmed = raw.trim()
    if (!trimmed || trimmed === "[]") return []

    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : [parsed]
  }

  /**
   * Normalize PS array that might be a single object.
   */
  private normalizeArray(val: any): any[] {
    if (!val) return []
    return Array.isArray(val) ? val : [val]
  }

  /**
   * Normalize the disk map from PowerShell.
   * ConvertTo-Json may serialize single-element arrays as bare objects,
   * so each value needs normalization.
   */
  private normalizeDiskMap(
    parsed: any
  ): Record<string, Array<{ Path: string; SizeBytes: number }>> {
    if (!parsed || typeof parsed !== "object") return {}

    const result: Record<string, Array<{ Path: string; SizeBytes: number }>> = {}
    for (const [key, val] of Object.entries(parsed)) {
      result[key] = this.normalizeArray(val).map((d: any) => ({
        Path: d?.Path || "",
        SizeBytes: typeof d?.SizeBytes === "number" ? d.SizeBytes : 0,
      }))
    }
    return result
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
      const n = parseInt(state, 10)
      if (!isNaN(n)) return this.stateNumberToString(n)
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
