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
  name?: string
  description?: string

  cpuInfo?: {
    sockets: number
    cores: number
    type: string
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
    pending?: {
      memory?: number
      balloon?: number
    }
  }
  disksInfo?: Array<{
    id: string
    storage: string
    size: string
    format?: string
    cache?: string
    iothread?: boolean
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
}

export type ActiveDialog =
  | 'none'
  | 'createVm'
  | 'createLxc'
  | 'addDisk'
  | 'addNetwork'
  | 'editScsiController'
  | 'editDisk'
  | 'editNetwork'
  | 'migrate'
  | 'clone'
  | 'createBackup'
  | 'deleteVm'
  | 'addReplication'
  | 'addCephReplication'
