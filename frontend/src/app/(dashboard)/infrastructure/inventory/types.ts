export type Status = 'ok' | 'warn' | 'crit' | 'unknown'

export type InventorySelection =
  | { type: 'root'; id: 'root' }
  | { type: 'cluster'; id: string }
  | { type: 'node'; id: string }
  | { type: 'vm'; id: string }
  | { type: 'storage'; id: string }
  | { type: 'pbs'; id: string }
  | { type: 'pbs-datastore'; id: string }
  | { type: 'datastore'; id: string }
  | { type: 'ext'; id: string }      // external hypervisor host (connectionId)
  | { type: 'ext-type'; id: string } // external hypervisor category (vmware, xcpng)
  | { type: 'extvm'; id: string }    // external hypervisor VM (connectionId:vmid)
  | { type: 'storage-root'; id: 'storage-root' }
  | { type: 'storage-cluster'; id: string }
  | { type: 'storage-node'; id: string }
  | { type: 'network-root'; id: 'network-root' }
  | { type: 'net-conn'; id: string }
  | { type: 'net-node'; id: string }
  | { type: 'net-vlan'; id: string }
  | { type: 'backup-root'; id: 'backup-root' }
  | { type: 'migration-root'; id: 'migration-root' }

export type Kpi = { label: string; value: string; hint?: string }
export type KV = { k: string; v: string }

export type UtilMetric = {
  label: string
  pct: number
  used?: number
  max?: number
  unitHint?: string
}

export type DetailsPayload = {
  kindLabel: string
  title: string
  subtitle?: string
  breadcrumb: string[]
  status: Status
  vmRealStatus?: string
  tags: string[]
  kpis: Kpi[]
  properties: KV[]
  metrics?: {
    cpu?: UtilMetric
    ram?: UtilMetric
    storage?: UtilMetric
    swap?: UtilMetric
  }
  lastUpdated: string
  isCluster?: boolean
  vmType?: 'qemu' | 'lxc'
  isTemplate?: boolean
  name?: string
  description?: string

  cpuInfo?: {
    sockets: number
    cores: number
    type: string
    flags?: Record<string, '+' | '-'>
    cpulimit?: number
    cpuunits?: number
    numa?: boolean
    pending?: {
      sockets?: number
      cores?: number
      cpu?: string
      cpulimit?: number
    }
  }
  memoryInfo?: {
    memory: number
    balloon?: number
    shares?: number
    swap?: number
    pending?: {
      memory?: number
      balloon?: number
      swap?: number
    }
  }
  disksInfo?: Array<{
    id: string
    storage: string
    size: string
    format?: string
    cache?: string
    iothread?: boolean
    mountpoint?: string
  }>
  networkInfo?: Array<{
    id: string
    model: string
    bridge: string
    macaddr?: string
    tag?: number
    firewall?: boolean
    rate?: number
  }>

  systemInfo?: {
    bios: string
    machine: string
    vga: string
    scsihw: string
  }

  otherHardwareInfo?: Array<{
    id: string
    type: 'efidisk' | 'tpmstate' | 'usb' | 'pci' | 'serial' | 'audio' | 'rng'
    label: string
    rawValue: string
    storage?: string
    size?: string
  }>

  cloudInitConfig?: {
    ciuser?: string
    cipassword?: string
    citype?: string
    nameserver?: string
    searchdomain?: string
    cicustom?: string
    sshkeys?: string
    ipconfigs?: Record<string, string>
    drive?: string
  } | null

  optionsInfo?: {
    onboot?: boolean
    protection?: boolean
    startAtBoot?: boolean
    startupOrder?: string
    ostype?: string
    bootOrder?: string
    useTablet?: boolean
    hotplug?: string
    acpi?: boolean
    kvmEnabled?: boolean
    freezeCpu?: boolean
    useLocalTime?: string
    rtcStartDate?: string
    smbiosUuid?: string
    agentEnabled?: boolean
    spiceEnhancements?: string
    vmStateStorage?: string
    amdSEV?: string
    scsihw?: string
  }
  nodeCapacity?: {
    maxCpu: number
    maxMem: number
    hostSockets?: number
    hostCoresPerSocket?: number
  }
  hostInfo?: {
    uptime?: number
    cpuModel?: string
    cpuCores?: number
    cpuSockets?: number
    kernelVersion?: string
    pveVersion?: string
    bootMode?: string
    loadAvg?: string
    ioDelay?: number
    ksmSharing?: number
    updates?: Array<{ package?: string; version?: string }>
    maintenance?: string
    subscription?: {
      status?: string
      nextDueDate?: string
      productName?: string
      key?: string
      type?: string
      serverId?: string
      sockets?: number
      lastChecked?: string
    }
  }

  connectedNode?: string | null

  nodesData?: Array<{
    id: string
    connId: string
    node: string
    name: string
    status: 'online' | 'offline' | 'maintenance'
    cpu: number
    ram: number
    storage: number
    vms?: number
    uptime?: number
    ip?: string
  }>
  vmsData?: Array<{
    id: string
    connId: string
    node: string
    vmid: string | number
    name: string
    type: 'qemu' | 'lxc'
    status: string
    cpu?: number
    ram?: number
    maxmem?: number
    maxdisk?: number
    uptime?: number
    tags?: string[]
    template?: boolean
    isCluster?: boolean
  }>

  cephHealth?: string

  allVms?: Array<{
    id: string
    connId: string
    connName?: string
    node: string
    vmid: number | string
    name: string
    status: string
    type: 'qemu' | 'lxc'
    template?: boolean
    cpu?: number
    cpuPct?: number
    ram?: number
    memPct?: number
    maxmem?: number
    disk?: number
    maxdisk?: number
    uptime?: number
    tags?: string[]
    isCluster?: boolean
  }>
  vmsCount?: number
  clusterName?: string | null

  pbsInfo?: {
    version?: string
    uptime?: number
    cpuInfo?: any
    memory?: any
    load?: any
    datastores: Array<{
      name: string
      path?: string
      comment?: string
      total: number
      used: number
      available: number
      usagePercent: number
      backupCount: number
      vmCount?: number
      ctCount?: number
      hostCount?: number
    }>
    backups: Array<{
      id: string
      datastore: string
      backupType: string
      backupId: string
      vmName?: string
      backupTime: number
      backupTimeFormatted: string
      size: number
      sizeFormatted: string
      verified?: boolean
      protected?: boolean
    }>
    stats: {
      total?: number
      vmCount?: number
      ctCount?: number
      hostCount?: number
      totalSize?: number
      totalSizeFormatted?: string
    }
    rrdData?: Array<{
      time: number
      cpu: number
      iowait: number
      loadavg: number
      memtotal: number
      memused: number
      memUsedPercent: number
      swaptotal: number
      swapused: number
      swapUsedPercent: number
      netin: number
      netout: number
      diskread: number
      diskwrite: number
      roottotal: number
      rootused: number
      rootUsedPercent: number
    }>
  }

  datastoreInfo?: {
    pbsId: string
    pbsName?: string
    name: string
    path?: string
    comment?: string
    total: number
    used: number
    available?: number
    usagePercent: number
    gcStatus?: any
    verifyStatus?: any
    backups: Array<{
      id: string
      datastore: string
      backupType: string
      backupId: string
      vmName?: string
      backupTime: number
      backupTimeFormatted: string
      size: number
      sizeFormatted: string
      verified?: boolean
      protected?: boolean
    }>
    stats: {
      total?: number
      vmCount?: number
      ctCount?: number
      hostCount?: number
      totalSize?: number
      totalSizeFormatted?: string
      verifiedCount?: number
      protectedCount?: number
    }
    pagination?: {
      page?: number
      pageSize?: number
      totalPages?: number
      totalItems?: number
    }
    rrdData?: Array<{
      time: number
      total: number
      used: number
      available: number
      usedPercent: number
      read: number
      write: number
      readIops: number
      writeIops: number
    }>
  }

  storageInfo?: {
    connId: string
    connName: string
    storage: string
    node: string
    type: string
    shared: boolean
    content: string[]
    enabled: boolean
    status: string
    used: number
    total: number
    usedPct: number
    path?: string
    server?: string
    pool?: string
    monhost?: string
    nodes?: string[]
    contentItems?: Array<{
      volid: string
      content: string
      format: string
      size: number
      ctime?: number
      vmid?: number
      notes?: string
      encrypted?: boolean | string
      verification?: { state: string; upid?: string } | null
    }>
  }

  extTypeInfo?: {
    hypervisorType: string // 'vmware' | 'xcpng'
    label: string
    hosts: Array<{
      connectionId: string
      connectionName: string
      baseUrl: string
      version?: string
      vms: Array<{
        vmid: string
        name: string
        status: string
        cpu?: number
        memory_size_MiB?: number
        guest_OS?: string
        committed?: number
      }>
    }>
    migrations?: any[]
  }

  esxiHostInfo?: {
    connectionId: string
    connectionName: string
    hostType: string  // 'vmware' | 'hyperv' | 'xcpng'
    baseUrl: string
    version?: string
    licenseFull?: boolean
    vms: Array<{
      vmid: string
      name: string
      status: string
      cpu?: number
      memory_size_MiB?: number
      guest_OS?: string
      committed?: number
      uncommitted?: number
    }>
  }

  esxiVmInfo?: {
    vmid: string
    connectionId: string
    connectionName: string
    name: string
    guestOS?: string
    numCPU: number
    numCoresPerSocket: number
    sockets: number
    memoryMB: number
    vmxVersion?: string
    uuid?: string
    firmware?: string
    annotation?: string
    toolsStatus?: string
    toolsRunningStatus?: string
    ipAddress?: string
    hostName?: string
    powerState: string
    bootTime?: string
    maxCpuUsage?: number
    committed: number
    uncommitted: number
    provisioned: number
    disks: Array<{
      label: string
      capacityBytes: number
      fileName: string
      thinProvisioned: boolean
    }>
    networks: Array<{
      label: string
      macAddress: string
      network: string
      connected: boolean
    }>
    snapshotCount: number
    licenseFull?: boolean
    hostType?: string
  }
}

export type RrdTimeframe = 'hour' | 'day' | 'week' | 'month' | 'year'

export type SeriesPoint = {
  t: number
  cpuPct?: number
  ramPct?: number
  loadAvg?: number
  netInBps?: number
  netOutBps?: number
  diskReadBps?: number
  diskWriteBps?: number
  // Extended metrics (matching PVE rrddata fields)
  iowait?: number
  memAvailable?: number
  arcSize?: number
  psiCpuSome?: number
  psiCpuFull?: number
  psiIoSome?: number
  psiIoFull?: number
  psiMemSome?: number
  psiMemFull?: number
}

export type ActiveDialog =
  | 'none'
  | 'createVm'
  | 'createLxc'
  | 'addDisk'
  | 'addNetwork'
  | 'addOtherHardware'
  | 'editScsiController'
  | 'editDisk'
  | 'editNetwork'
  | 'migrate'
  | 'clone'
  | 'createBackup'
  | 'deleteVm'
  | 'convertTemplate'
  | 'addReplication'
  | 'addCephReplication'
