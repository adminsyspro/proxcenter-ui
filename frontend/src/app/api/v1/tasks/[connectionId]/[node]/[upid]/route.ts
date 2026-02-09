import { NextResponse } from 'next/server'

import { pveFetch } from '@/lib/proxmox/client'
import { getConnectionById } from '@/lib/connections/getConnection'
import { formatBytes as formatSize } from '@/utils/format'

export const runtime = 'nodejs'

type TaskStatus = {
  status: string
  exitstatus?: string
  type?: string
  id?: string
  node?: string
  user?: string
  starttime?: number
  endtime?: number
  pid?: number
}

type TaskLogEntry = {
  n: number
  t: string
}

type DiskProgress = {
  name: string
  totalBytes: number
  transferredBytes: number
  completed: boolean
  lastUpdateTime: number // secondes depuis début
  speed: number // bytes/s
}

type MigrationState = {
  phase: 'init' | 'storage' | 'live' | 'finalizing' | 'completed'
  disks: Map<string, DiskProgress>
  liveTransferred: number
  liveTotalSize: number
  liveSpeed: number
  totalTransferred: number
  totalSize: number
  currentSpeed: number
  averageSpeed: number
  eta: number // secondes restantes
  message: string
}

function formatDuration(seconds: number): string {
  if (seconds < 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  
return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

function parseSize(value: string, unit: string): number {
  const num = parseFloat(value)
  const unitLower = unit.toLowerCase()

  if (unitLower === 'b') return num
  if (unitLower === 'kib' || unitLower === 'kb') return num * 1024
  if (unitLower === 'mib' || unitLower === 'mb') return num * 1024 * 1024
  if (unitLower === 'gib' || unitLower === 'gb') return num * 1024 * 1024 * 1024
  if (unitLower === 'tib' || unitLower === 'tb') return num * 1024 * 1024 * 1024 * 1024
  
return num
}


function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '—'
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KiB/s`
  if (bytesPerSec < 1024 * 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MiB/s`
  
return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(1)} GiB/s`
}

function parseMigrationProgress(logs: TaskLogEntry[]): { progress: number; message: string; speed: string; eta: string } {
  if (!logs || !Array.isArray(logs) || logs.length === 0) {
    return { progress: 0, message: 'Démarrage...', speed: '', eta: '' }
  }

  const state: MigrationState = {
    phase: 'init',
    disks: new Map(),
    liveTransferred: 0,
    liveTotalSize: 0,
    liveSpeed: 0,
    totalTransferred: 0,
    totalSize: 0,
    currentSpeed: 0,
    averageSpeed: 0,
    eta: -1,
    message: 'Démarrage...'
  }

  // Regex patterns
  const transferRegex = /(drive-\S+|scsi\d+|virtio\d+|ide\d+|sata\d+|efidisk\d+):\s*transferred\s+([\d.]+)\s*(\w+)\s+of\s+([\d.]+)\s*(\w+)\s*\(([\d.]+)%\)(?:\s+in\s+(\d+)s)?/i
  const diskReadyRegex = /(drive-\S+|scsi\d+|virtio\d+|ide\d+|sata\d+|efidisk\d+).*?(\d+[\d.]*)\s*(\w+).*ready$/i
  const liveProgressRegex = /migration active.*?transferred\s+([\d.]+)\s*(\w+)\s+of\s+([\d.]+)\s*(\w+)\s+VM-state,?\s*([\d.]+)\s*(\w+)\/s/i
  const avgSpeedRegex = /average migration speed:\s*([\d.]+)\s*(\w+)\/s/i
  const finishedRegex = /migration finished successfully/i
  const liveStartRegex = /starting online\/live migration/i
  const liveCompletedRegex = /migration (completed|status: completed)/i
  const mirrorReadyRegex = /all 'mirror' jobs are ready/i
  const switchingRegex = /switching mirror jobs to actively synced mode/i

  let lastDiskName = ''
  let lastTransferTime = 0
  let startTime = 0

  for (const entry of logs) {
    const text = entry?.t || ''

    // Extraire le timestamp si présent (format: 2026-01-23 15:42:29)
    const timeMatch = text.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/)

    if (timeMatch && startTime === 0) {
      startTime = new Date(timeMatch[1]).getTime() / 1000
    }

    // Fin de migration
    if (finishedRegex.test(text)) {
      state.phase = 'completed'
      state.message = 'Migration terminée avec succès'
      continue
    }

    // Progression transfert disque
    const transferMatch = text.match(transferRegex)

    if (transferMatch) {
      const diskName = transferMatch[1]
      const transferred = parseSize(transferMatch[2], transferMatch[3])
      const total = parseSize(transferMatch[4], transferMatch[5])
      const timeInSec = transferMatch[7] ? parseInt(transferMatch[7]) : 0

      const existingDisk = state.disks.get(diskName)
      const prevTransferred = existingDisk?.transferredBytes || 0
      const prevTime = existingDisk?.lastUpdateTime || 0

      // Calculer la vitesse pour ce disque
      let speed = 0

      if (timeInSec > 0 && transferred > 0) {
        speed = transferred / timeInSec
      } else if (timeInSec > prevTime && transferred > prevTransferred) {
        speed = (transferred - prevTransferred) / (timeInSec - prevTime)
      }

      state.disks.set(diskName, {
        name: diskName,
        totalBytes: total,
        transferredBytes: transferred,
        completed: transferred >= total,
        lastUpdateTime: timeInSec,
        speed: speed
      })

      lastDiskName = diskName
      lastTransferTime = timeInSec
      state.phase = 'storage'
      state.currentSpeed = speed
      state.message = `${diskName}: ${formatSize(transferred)} / ${formatSize(total)}`
      continue
    }

    // Disque ready
    const readyMatch = text.match(diskReadyRegex)

    if (readyMatch) {
      const diskName = readyMatch[1]
      const disk = state.disks.get(diskName)

      if (disk) {
        disk.completed = true
        disk.transferredBytes = disk.totalBytes
      }

      continue
    }

    // Tous les mirrors prêts
    if (mirrorReadyRegex.test(text)) {
      state.message = 'Disques synchronisés'
      continue
    }

    // Switching to active sync
    if (switchingRegex.test(text)) {
      state.message = 'Synchronisation active...'
      continue
    }

    // Début migration live
    if (liveStartRegex.test(text)) {
      state.phase = 'live'
      state.message = 'Migration live de la mémoire...'
      continue
    }

    // Progression migration live
    const liveMatch = text.match(liveProgressRegex)

    if (liveMatch) {
      state.phase = 'live'
      state.liveTransferred = parseSize(liveMatch[1], liveMatch[2])
      state.liveTotalSize = parseSize(liveMatch[3], liveMatch[4])
      state.liveSpeed = parseSize(liveMatch[5], liveMatch[6])
      state.currentSpeed = state.liveSpeed
      state.message = `Mémoire: ${formatSize(state.liveTransferred)} / ${formatSize(state.liveTotalSize)}`
      continue
    }

    // Vitesse moyenne
    const avgMatch = text.match(avgSpeedRegex)

    if (avgMatch) {
      state.averageSpeed = parseSize(avgMatch[1], avgMatch[2])
      continue
    }

    // Migration live terminée
    if (liveCompletedRegex.test(text)) {
      state.phase = 'finalizing'
      state.message = 'Finalisation...'
      continue
    }

    // Messages génériques
    if (text.includes('starting migration of VM')) {
      state.message = 'Démarrage de la migration...'
    } else if (text.includes('starting storage migration')) {
      state.phase = 'storage'
      state.message = 'Migration du stockage...'
    } else if (text.includes('stopping NBD')) {
      state.phase = 'finalizing'
      state.message = 'Nettoyage...'
    }
  }

  // Calcul des totaux
  let totalBytes = 0
  let transferredBytes = 0
  let weightedSpeed = 0
  let speedCount = 0

  state.disks.forEach(disk => {
    totalBytes += disk.totalBytes
    transferredBytes += disk.transferredBytes

    if (disk.speed > 0) {
      weightedSpeed += disk.speed
      speedCount++
    }
  })

  // Ajouter la RAM si en phase live ou après
  if (state.phase === 'live' || state.phase === 'finalizing' || state.phase === 'completed') {
    if (state.liveTotalSize > 0) {
      totalBytes += state.liveTotalSize
      transferredBytes += state.liveTransferred
    }
  }

  state.totalSize = totalBytes
  state.totalTransferred = transferredBytes

  // Calcul de la progression globale
  let progress = 0

  if (state.phase === 'completed') {
    progress = 100
  } else if (totalBytes > 0) {
    // Progression basée sur les bytes transférés
    const baseProgress = (transferredBytes / totalBytes) * 100

    // Ajuster selon la phase (la finalisation prend peu de temps)
    if (state.phase === 'finalizing') {
      progress = Math.max(baseProgress, 95)
    } else {
      progress = baseProgress * 0.95 // Laisser 5% pour la finalisation
    }
  }

  // Calcul de la vitesse moyenne
  if (state.averageSpeed > 0) {
    state.currentSpeed = state.averageSpeed
  } else if (speedCount > 0) {
    state.currentSpeed = weightedSpeed / speedCount
  }

  // Calcul ETA
  let eta = -1

  if (state.currentSpeed > 0 && totalBytes > transferredBytes) {
    const remainingBytes = totalBytes - transferredBytes

    eta = remainingBytes / state.currentSpeed
  }

  // Formater le message final
  let finalMessage = state.message

  if (state.phase === 'storage' || state.phase === 'live') {
    if (totalBytes > 0) {
      finalMessage = `Transfert: ${formatSize(transferredBytes)} / ${formatSize(totalBytes)}`
    }
  }

  return {
    progress: Math.min(Math.round(progress * 10) / 10, 100),
    message: finalMessage,
    speed: state.currentSpeed > 0 ? formatSpeed(state.currentSpeed) : '',
    eta: eta > 0 ? formatDuration(eta) : ''
  }
}

function parseGenericProgress(logs: TaskLogEntry[]): { progress: number; message: string; speed: string; eta: string } {
  if (!logs || !Array.isArray(logs) || logs.length === 0) {
    return { progress: 0, message: 'Démarrage...', speed: '', eta: '' }
  }

  let progress = 0
  let message = 'En cours...'
  let speed = ''

  const progressRegex = /(\d+(?:\.\d+)?)\s*%/
  const transferRegex = /transferred\s+([\d.]+)\s*(\w+)\s+of\s+([\d.]+)\s*(\w+)/i
  const speedRegex = /([\d.]+)\s*(\w+)\/s/

  for (const entry of logs) {
    const text = entry?.t || ''

    const progressMatch = text.match(progressRegex)

    if (progressMatch) {
      const pct = parseFloat(progressMatch[1])

      if (pct > progress) {
        progress = pct
      }
    }

    const transferMatch = text.match(transferRegex)

    if (transferMatch) {
      message = `Transfert: ${transferMatch[1]} ${transferMatch[2]} / ${transferMatch[3]} ${transferMatch[4]}`
    }

    const speedMatch = text.match(speedRegex)

    if (speedMatch) {
      speed = `${speedMatch[1]} ${speedMatch[2]}/s`
    }

    if (text.includes('TASK OK')) {
      progress = 100
      message = 'Terminé avec succès'
    }
  }

  return { progress, message, speed, eta: '' }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ connectionId: string; node: string; upid: string }> }
) {
  try {
    const { connectionId, node, upid } = await params
    const decodedUpid = decodeURIComponent(upid)

    const connection = await getConnectionById(connectionId)

    if (!connection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    let status: TaskStatus

    try {
      status = await pveFetch<TaskStatus>(
        connection,
        `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(decodedUpid)}/status`
      )
    } catch (e: any) {
      console.error('Failed to fetch task status:', e)
      
return NextResponse.json({ error: `Failed to fetch task status: ${e.message}` }, { status: 500 })
    }

    let logs: TaskLogEntry[] = []

    try {
      // Fetch logs in batches to handle long-running tasks (e.g. multi-TiB migrations)
      const BATCH_SIZE = 5000
      let start = 0

      while (true) {
        const batch = await pveFetch<TaskLogEntry[]>(
          connection,
          `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(decodedUpid)}/log?start=${start}&limit=${BATCH_SIZE}`
        )

        if (!Array.isArray(batch) || batch.length === 0) break
        logs = logs.concat(batch)

        if (batch.length < BATCH_SIZE) break
        start += batch.length

        // Safety cap: 100K lines max to prevent infinite loops
        if (logs.length >= 100000) break
      }
    } catch (e: any) {
      console.warn('Failed to fetch task logs:', e.message)
    }

    const now = Math.floor(Date.now() / 1000)
    const startTime = status?.starttime || now
    const endTime = status?.endtime || (status?.status === 'stopped' ? now : undefined)
    const duration = endTime ? endTime - startTime : now - startTime

    let progressData: { progress: number; message: string; speed: string; eta: string }
    
    if (status?.status === 'stopped') {
      progressData = {
        progress: 100,
        message: status?.exitstatus === 'OK' ? 'Terminé avec succès' : `Échec: ${status?.exitstatus || 'erreur inconnue'}`,
        speed: '',
        eta: ''
      }
    } else {
      const taskType = status?.type || ''

      if (taskType.includes('migrate') || taskType === 'qmigrate' || taskType === 'vzmigrate') {
        progressData = parseMigrationProgress(logs)
      } else {
        progressData = parseGenericProgress(logs)
      }
    }

    // Send at most 5000 log lines to the frontend to avoid huge payloads
    const MAX_FRONTEND_LOGS = 5000
    const totalLogLines = logs.length
    const truncatedLogs = totalLogLines > MAX_FRONTEND_LOGS
      ? logs.slice(totalLogLines - MAX_FRONTEND_LOGS)
      : logs

    const response = {
      upid: decodedUpid,
      node,
      type: status?.type || null,
      id: status?.id || null,
      user: status?.user || null,
      status: status?.status || 'unknown',
      exitstatus: status?.exitstatus || null,
      starttime: status?.starttime || null,
      endtime: status?.endtime || null,
      duration: formatDuration(duration),
      durationSec: duration,
      progress: progressData.progress,
      message: progressData.message,
      speed: progressData.speed,
      eta: progressData.eta,
      totalLogLines,
      logs: truncatedLogs.map(l => ({ n: l?.n || 0, t: l?.t || '' }))
    }

    return NextResponse.json(response)
  } catch (error: any) {
    console.error('Error in task details API:', error)
    
return NextResponse.json(
      { error: error?.message || 'Server error' },
      { status: 500 }
    )
  }
}