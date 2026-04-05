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
   * Falls back to reading disk_list from the VM detail endpoint
   * if the dedicated disk_list endpoint is unavailable.
   */
  async listDisks(vmUuid: string): Promise<NutanixDisk[]> {
    // Try the dedicated disk_list endpoint first
    try {
      const data = await this.get<any>(`/vms/${vmUuid}/disk_list`)
      const diskList: any[] = data.entities || data.disk_list || data || []
      if (Array.isArray(diskList) && diskList.length > 0) {
        return diskList.map((d: any, i: number) => this.parseDisk(d, i))
      }
    } catch {
      // Fallback: extract disk_list from VM detail
    }

    // Fallback: get VM details and extract disk_list from resources
    const vm = await this.get<any>(`/vms/${vmUuid}`)
    const diskList: any[] = vm.status?.resources?.disk_list || vm.spec?.resources?.disk_list || []

    return diskList
      .filter((d: any) => d.device_properties?.device_type !== "CDROM")
      .map((d: any, i: number) => this.parseDisk(d, i))
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
    imageName: string
  ): Promise<{ imageUuid: string; taskUuid: string }> {
    const body = {
      spec: {
        name: imageName,
        resources: {
          image_type: "DISK_IMAGE",
          data_source_reference: {
            kind: "vm_disk",
            uuid: diskUuid,
          },
          source_uri: undefined as undefined,
        },
        description: `ProxCenter migration export from VM ${vmUuid}`,
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

    return {
      uuid: disk.uuid || diskAddress.device_uuid || "",
      deviceIndex: diskAddress.device_index ?? fallbackIndex,
      sizeBytes: disk.disk_size_bytes || (disk.disk_size_mib ? disk.disk_size_mib * 1048576 : 0),
      storageContainerUuid: disk.storage_config?.storage_container_reference?.uuid || undefined,
      deviceBus: diskAddress.adapter_type || (props.device_type === "CDROM" ? "IDE" : "SCSI"),
    }
  }
}
