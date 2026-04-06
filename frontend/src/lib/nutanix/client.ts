/**
 * Nutanix Prism v3 REST API client
 *
 * Prism Central exposes a REST API at https://<prism-central>:9440/api/nutanix/v3/
 * with Basic auth (username:password).
 *
 * Key endpoints for migration:
 * - POST /api/nutanix/v3/vms/list         - List VMs
 * - GET  /api/nutanix/v3/vms/{uuid}       - Get VM details
 * - GET  /api/nutanix/v3/vms/{uuid}/disk_list - List VM disks
 * - POST /api/nutanix/v3/images           - Create image from disk (for download)
 * - GET  /api/nutanix/v3/images/{uuid}/file - Download image file
 * - POST /api/nutanix/v3/clusters/list    - List clusters (used for test connection)
 */

export interface NutanixConnection {
  baseUrl: string
  username: string
  password: string
  insecureTLS?: boolean
}

export interface NutanixVm {
  uuid: string
  name: string
  powerState: string // "ON", "OFF"
  numCpus: number
  memoryMB: number
  diskSizeBytes: number
  numDisks: number
  clusterName?: string
  hostName?: string
  description?: string
  osType?: string
}

export interface NutanixDisk {
  uuid: string
  deviceIndex: number
  sizeBytes: number
  storageContainerUuid?: string
  deviceBus: string // "SCSI", "IDE", "SATA"
  volumeGroupUuid?: string // Set when disk is from a Volume Group
}

export class NutanixClient {
  private baseUrl: string
  private authHeader: string
  private insecureTLS: boolean

  constructor(conn: NutanixConnection) {
    this.baseUrl = conn.baseUrl.replace(/\/$/, "")
    this.authHeader = `Basic ${Buffer.from(`${conn.username}:${conn.password}`).toString("base64")}`
    this.insecureTLS = conn.insecureTLS ?? false
  }

  // ----------------------------------------------------------------
  // Internal HTTP helpers
  // ----------------------------------------------------------------

  private async fetchOpts(): Promise<Record<string, any>> {
    const opts: Record<string, any> = {
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    }

    if (this.insecureTLS) {
      opts.dispatcher = new (await import("undici")).Agent({
        connect: { rejectUnauthorized: false },
      })
    }

    return opts
  }

  private async get<T = any>(path: string): Promise<T> {
    const opts = await this.fetchOpts()
    const url = `${this.baseUrl}/api/nutanix/v3${path}`
    const res = await fetch(url, opts)

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Nutanix API GET ${path} failed: ${res.status} ${res.statusText} ${body}`)
    }

    return res.json()
  }

  private async post<T = any>(path: string, body: Record<string, any>): Promise<T> {
    const opts = await this.fetchOpts()
    opts.method = "POST"
    opts.body = JSON.stringify(body)
    // POST operations (image creation, snapshots) can take longer
    opts.signal = AbortSignal.timeout(120_000)

    const url = `${this.baseUrl}/api/nutanix/v3${path}`
    const res = await fetch(url, opts)

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`Nutanix API POST ${path} failed: ${res.status} ${res.statusText} ${text}`)
    }

    return res.json()
  }

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  /**
   * Test connection by listing clusters.
   * Returns the Prism version and first cluster name.
   */
  async testConnection(): Promise<{ version: string; clusterName: string }> {
    const data = await this.post<any>("/clusters/list", { kind: "cluster", length: 1 })
    const entities: any[] = data.entities || []

    if (entities.length === 0) {
      throw new Error("No clusters found - verify Prism Central credentials and permissions")
    }

    const cluster = entities[0]
    const version =
      cluster.status?.resources?.config?.software_map?.NOS?.version ||
      cluster.status?.resources?.config?.build?.version ||
      "unknown"
    const clusterName =
      cluster.status?.name ||
      cluster.spec?.name ||
      "unknown"

    return { version, clusterName }
  }

  /**
   * List all VMs from Prism Central.
   * Paginates through all VMs using offset-based pagination.
   */
  async listVMs(): Promise<NutanixVm[]> {
    const pageSize = 500
    const allVMs: NutanixVm[] = []
    let offset = 0

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const data = await this.post<any>("/vms/list", {
        kind: "vm",
        length: pageSize,
        offset,
      })

      const entities: any[] = data.entities || []
      if (entities.length === 0) break

      for (const entity of entities) {
        allVMs.push(this.parseVmEntity(entity))
      }

      const totalMatches = data.metadata?.total_matches ?? 0
      offset += entities.length
      if (offset >= totalMatches) break
    }

    return allVMs
  }

  /**
   * Get a single VM by UUID.
   */
  async getVM(uuid: string): Promise<NutanixVm> {
    const entity = await this.get<any>(`/vms/${uuid}`)
    return this.parseVmEntity(entity)
  }

  /**
   * List disks attached to a VM.
   * Checks both direct disk_list on the VM AND Volume Groups attached to the VM.
   */
  async listDisks(vmUuid: string): Promise<NutanixDisk[]> {
    const disks: NutanixDisk[] = []

    // Get VM details to inspect disk_list
    let vmDiskList: any[] = []
    try {
      const vm = await this.get<any>(`/vms/${vmUuid}`)
      vmDiskList = vm.status?.resources?.disk_list || vm.spec?.resources?.disk_list || []
    } catch {}

    // Pre-fetch Volume Groups (needed if any disk is type VOLUME_GROUP)
    let vgMap = new Map<string, any>() // vgUuid -> vg entity
    const hasVgDisks = vmDiskList.some((d: any) => d.device_properties?.device_type === "VOLUME_GROUP")
    if (hasVgDisks) {
      try {
        const vgData = await this.post<any>("/volume_groups/list", { kind: "volume_group", length: 100 })
        for (const vg of (vgData.entities || [])) {
          vgMap.set(vg.metadata?.uuid, vg)
        }
      } catch {}
    }

    for (const disk of vmDiskList) {
      const deviceType = disk.device_properties?.device_type
      if (deviceType === "CDROM") continue

      if (deviceType === "VOLUME_GROUP" && disk.volume_group_reference?.uuid) {
        // Resolve actual disks from the Volume Group
        const vg = vgMap.get(disk.volume_group_reference.uuid)
        if (vg) {
          const vgDisks: any[] = vg.status?.resources?.disk_list || vg.spec?.resources?.disk_list || []
          for (const vgDisk of vgDisks) {
            disks.push({
              uuid: vgDisk.uuid || "",
              deviceIndex: vgDisk.index ?? disks.length,
              sizeBytes: vgDisk.disk_size_bytes || (vgDisk.disk_size_mib ? vgDisk.disk_size_mib * 1048576 : 0),
              storageContainerUuid: vgDisk.storage_container_uuid || undefined,
              deviceBus: "SCSI",
              volumeGroupUuid: vg.metadata?.uuid,
            })
          }
        }
      } else {
        // Direct disk (not VG, not CDROM)
        disks.push(this.parseDisk(disk, disks.length))
      }
    }

    return disks
  }

  /**
   * Get the download URL for a VM disk image.
   *
   * Nutanix disk download flow:
   * 1. Create an image from the VM disk via POST /images
   * 2. Download the image via GET /images/{image-uuid}/file
   *
   * This method returns the image file download URL.
   * The caller is responsible for creating the image first via createDiskImage().
   */
  getDiskDownloadUrl(imageUuid: string): string {
    return `${this.baseUrl}/api/nutanix/v3/images/${imageUuid}/file`
  }

  /**
   * Create an image from a VM disk for download.
   * Returns the image UUID and its task UUID for status polling.
   */
  async createDiskImage(
    vmUuid: string,
    diskUuid: string,
    imageName: string,
    _isVolumeGroupDisk?: boolean
  ): Promise<{ imageUuid: string; taskUuid: string }> {
    console.log(`[nutanix] createDiskImage: vmUuid=${vmUuid}, diskUuid=${diskUuid}, imageName=${imageName}`)
    const body = {
      spec: {
        name: imageName,
        resources: {
          image_type: "DISK_IMAGE",
          data_source_reference: {
            kind: "vm_disk",
            uuid: diskUuid,
          },
        },
      },
      metadata: {
        kind: "image",
      },
    }

    const data = await this.post<any>("/images", body)
    const imageUuid = data.metadata?.uuid
    const taskUuid = data.status?.execution_context?.task_uuid

    if (!imageUuid) {
      throw new Error(`Failed to create disk image: no UUID in response ${JSON.stringify(data).slice(0, 500)}`)
    }

    return { imageUuid, taskUuid: taskUuid || "" }
  }

  /**
   * Poll a task until it completes.
   * Returns when the task reaches SUCCEEDED status.
   * Throws if the task fails or times out.
   */
  async waitForTask(taskUuid: string, timeoutMs = 600_000): Promise<void> {
    const start = Date.now()

    while (Date.now() - start < timeoutMs) {
      const task = await this.get<any>(`/tasks/${taskUuid}`)
      const status = task.status || task.progress_status || ""

      if (status === "SUCCEEDED" || status === "COMPLETE") return

      if (status === "FAILED" || status === "ABORTED") {
        const errMsg = task.error_detail || task.error_code || "unknown error"
        throw new Error(`Nutanix task ${taskUuid} failed: ${errMsg}`)
      }

      // Still running - wait before polling again
      await new Promise(r => setTimeout(r, 3000))
    }

    throw new Error(`Nutanix task ${taskUuid} timed out after ${timeoutMs / 1000}s`)
  }

  /**
   * Delete an image (cleanup after migration).
   */
  async deleteImage(imageUuid: string): Promise<void> {
    const opts = await this.fetchOpts()
    opts.method = "DELETE"

    const url = `${this.baseUrl}/api/nutanix/v3/images/${imageUuid}`
    const res = await fetch(url, opts)

    if (!res.ok && res.status !== 404) {
      throw new Error(`Nutanix API DELETE /images/${imageUuid} failed: ${res.status} ${res.statusText}`)
    }
  }

  /**
   * Get the Basic auth header value for use in curl commands on remote nodes.
   */
  getAuthHeader(): string {
    return this.authHeader
  }

  // ----------------------------------------------------------------
  // Internal parsing helpers
  // ----------------------------------------------------------------

  private parseVmEntity(entity: any): NutanixVm {
    const status = entity.status || {}
    const resources = status.resources || {}
    const spec = entity.spec || {}
    const specResources = spec.resources || {}

    // CPU: sockets * vcpus_per_socket
    const numSockets = resources.num_sockets || specResources.num_sockets || 1
    const vcpusPerSocket = resources.num_vcpus_per_socket || specResources.num_vcpus_per_socket || 1
    const numCpus = numSockets * vcpusPerSocket

    // Memory: in MiB
    const memoryMB = resources.memory_size_mib || specResources.memory_size_mib || 0

    // Disks: sum sizes, count non-CDROM disks
    const diskList: any[] = resources.disk_list || specResources.disk_list || []
    const dataDisks = diskList.filter((d: any) => d.device_properties?.device_type !== "CDROM")

    let diskSizeBytes = 0
    for (const d of dataDisks) {
      diskSizeBytes += d.disk_size_bytes || (d.disk_size_mib ? d.disk_size_mib * 1048576 : 0)
    }

    // Cluster reference
    const clusterRef = resources.cluster_reference || specResources.cluster_reference || {}
    const clusterName = clusterRef.name || undefined

    // Host reference
    const hostRef = resources.host_reference || specResources.host_reference || {}
    const hostName = hostRef.name || undefined

    // Guest OS
    const guestTools = resources.guest_tools || {}
    const osType = resources.guest_customization?.cloud_init?.meta_data
      ? undefined
      : guestTools.nutanix_guest_tools?.guest_os_version || undefined

    return {
      uuid: entity.metadata?.uuid || "",
      name: status.name || spec.name || "Unknown",
      powerState: resources.power_state || "OFF",
      numCpus,
      memoryMB,
      diskSizeBytes,
      numDisks: dataDisks.length,
      clusterName,
      hostName,
      description: status.description || spec.description || undefined,
      osType,
    }
  }

  private parseDisk(disk: any, fallbackIndex: number): NutanixDisk {
    const props = disk.device_properties || {}
    const diskAddress = props.disk_address || {}

    // The UUID for image creation must be the data_source_reference UUID (vmdisk UUID),
    // not the disk entry UUID or device_uuid
    const vmdiskUuid = disk.data_source_reference?.uuid
      || disk.uuid
      || diskAddress.device_uuid
      || ""

    return {
      uuid: vmdiskUuid,
      deviceIndex: diskAddress.device_index ?? fallbackIndex,
      sizeBytes: disk.disk_size_bytes || (disk.disk_size_mib ? disk.disk_size_mib * 1048576 : 0),
      storageContainerUuid: disk.storage_config?.storage_container_reference?.uuid || undefined,
      deviceBus: diskAddress.adapter_type || (props.device_type === "CDROM" ? "IDE" : "SCSI"),
    }
  }
}
