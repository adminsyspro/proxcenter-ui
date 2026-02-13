import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { getDb } from "@/lib/db/sqlite"

export const runtime = "nodejs"

// Charger les paramètres Green depuis la base de données
async function loadGreenSettings() {
  try {
    const db = getDb()
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?')
    const row = stmt.get('green') as { value: string } | undefined

    if (row?.value) {
      return JSON.parse(row.value)
    }
  } catch (e: any) {
    // Silencieux si la table n'existe pas (Community mode)
    if (!e?.message?.includes('no such table')) {
      console.warn('Failed to load green settings:', e?.message)
    }
  }

  return null
}

/**
 * GET /api/v1/resources/overview
 * 
 * Retourne une vue d'ensemble des ressources de l'infrastructure :
 * - KPIs globaux (CPU, RAM, Storage, VMs)
 * - Tendances sur 7 jours (données RRD réelles)
 * - Top VMs consommatrices
 */

type NodeData = {
  node: string
  status: string
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
  disk?: number
  maxdisk?: number
}

type VmData = {
  vmid: number
  name?: string
  node: string
  type: string
  status: string
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
  disk?: number
  maxdisk?: number
}

type RrdPoint = {
  time: number
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
  memused?: number
  memtotal?: number
  netin?: number
  netout?: number
  diskread?: number
  diskwrite?: number
  rootused?: number
  roottotal?: number

  // Pour le stockage
  used?: number
  total?: number
}

// Agréger les données RRD par jour - stocke les valeurs par node pour une agrégation correcte
type DayNodeData = {
  nodes: Map<string, { cpu: number[], ram: number[], maxCpu: number, maxMem: number }>
}

function aggregateRrdByDayPerNode(
  rrdData: RrdPoint[], 
  nodeName: string,
  maxCpu: number, 
  maxMem: number
): Map<string, { cpu: number[], ram: number[] }> {
  const byDay = new Map<string, { cpu: number[], ram: number[] }>()
  
  let validCpuCount = 0
  let validRamCount = 0
  let skippedCpu = 0
  let skippedRam = 0
  let firstValidPoint: RrdPoint | null = null
  
  for (const point of rrdData) {
    if (!point.time) continue
    
    const date = new Date(point.time * 1000)
    const dayKey = date.toISOString().split('T')[0] // YYYY-MM-DD
    
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, { cpu: [], ram: [] })
    }
    
    const day = byDay.get(dayKey)!
    
    // CPU: Proxmox retourne un ratio 0-1 pour les nodes
    if (point.cpu !== undefined && point.cpu !== null) {
      const cpuVal = Number(point.cpu)

      if (!isNaN(cpuVal) && isFinite(cpuVal) && cpuVal >= 0) {
        // CPU est un ratio 0-1, on le convertit en pourcentage
        const cpuPct = cpuVal * 100

        day.cpu.push(Math.max(0, Math.min(100, cpuPct)))
        validCpuCount++
        if (!firstValidPoint) firstValidPoint = point
      } else {
        skippedCpu++
      }
    } else {
      skippedCpu++
    }
    
    // RAM: Proxmox utilise "memused" et "memtotal"
    const memUsed = Number(point.memused ?? point.mem ?? 0)
    const memTotal = Number(point.memtotal ?? point.maxmem ?? maxMem)
    
    if (memUsed > 0 && memTotal > 0 && !isNaN(memUsed) && !isNaN(memTotal)) {
      const ramPct = (memUsed / memTotal) * 100

      if (isFinite(ramPct) && ramPct >= 0 && ramPct <= 100) {
        day.ram.push(ramPct)
        validRamCount++
        if (!firstValidPoint) firstValidPoint = point
      } else {
        skippedRam++
      }
    } else {
      skippedRam++
    }
  }
  
  // Debug avec le premier point VALIDE (pas le premier point qui peut être vide)
  if (firstValidPoint) {
  } else {
  }
  
  // Supprimer les jours sans données valides
  for (const [dayKey, dayData] of byDay) {
    if (dayData.cpu.length === 0 && dayData.ram.length === 0) {
      byDay.delete(dayKey)
    }
  }
  
  
  return byDay
}

// Structure pour stocker les données de tous les nodes par jour
type GlobalDayData = {
  nodeData: Map<string, { cpuAvg: number, ramAvg: number, maxCpu: number, maxMem: number }>
}

// Calculer les moyennes globales pondérées par la capacité de chaque node
// Ignore les nodes avec utilisation < 5% (clusters vides ou en cours de déploiement)
// Retourne aussi le nombre de nodes pour chaque jour pour détecter les anomalies
function calculateGlobalAverages(
  allNodesData: Map<string, Map<string, { cpu: number[], ram: number[] }>>,
  nodeCapacities: Map<string, { maxCpu: number, maxMem: number }>
): Map<string, { cpu: number, ram: number, nodeCount: number }> {
  
  
  // Collecter tous les jours uniques (seulement ceux avec des données)
  const allDays = new Set<string>()

  for (const [nodeName, nodeData] of allNodesData) {
    const daysWithData = Array.from(nodeData.entries()).filter(([_, d]) => d.cpu.length > 0 || d.ram.length > 0)

    for (const [day] of daysWithData) {
      allDays.add(day)
    }
  }
  
  
  const result = new Map<string, { cpu: number, ram: number, nodeCount: number }>()
  
  // Pour le debug, suivre quelques jours
  const sortedDays = Array.from(allDays).sort()

  const debugDays = new Set([
    sortedDays[0],  // Premier jour
    sortedDays[Math.floor(sortedDays.length / 2)],  // Milieu
    sortedDays[sortedDays.length - 1]  // Dernier jour
  ])
  
  // Seuil minimum d'utilisation RAM pour inclure un node (évite les clusters vides)
  const MIN_RAM_USAGE = 5 // 5%
  
  for (const day of allDays) {
    let totalCpuWeighted = 0
    let totalCpuCapacity = 0
    let totalRamWeighted = 0
    let totalRamCapacity = 0
    let nodesWithCpu = 0
    let nodesWithRam = 0
    let nodesSkipped = 0
    
    const isDebugDay = debugDays.has(day)
    
    for (const [nodeName, nodeData] of allNodesData) {
      const dayData = nodeData.get(day)
      const capacity = nodeCapacities.get(nodeName)
      
      if (!dayData || !capacity) continue
      
      // Calculer la RAM moyenne pour ce node ce jour
      const nodeRamAvg = dayData.ram.length > 0 
        ? dayData.ram.reduce((a, b) => a + b, 0) / dayData.ram.length 
        : 0
      
      // Ignorer les nodes avec utilisation RAM < seuil (clusters vides)
      if (nodeRamAvg < MIN_RAM_USAGE && dayData.ram.length > 0) {
        nodesSkipped++

        if (isDebugDay) {
        }

        continue
      }
      
      // CPU: moyenne pondérée par le nombre de cores
      if (dayData.cpu.length > 0) {
        const nodeCpuAvg = dayData.cpu.reduce((a, b) => a + b, 0) / dayData.cpu.length

        totalCpuWeighted += nodeCpuAvg * capacity.maxCpu
        totalCpuCapacity += capacity.maxCpu
        nodesWithCpu++
        
        if (isDebugDay) {
        }
      }
      
      // RAM: moyenne pondérée par la capacité RAM
      if (dayData.ram.length > 0) {
        totalRamWeighted += nodeRamAvg * capacity.maxMem
        totalRamCapacity += capacity.maxMem
        nodesWithRam++
        
        if (isDebugDay) {
        }
      }
    }
    
    // Calculer les moyennes pondérées globales
    // SEULEMENT si on a au moins un node avec des données significatives
    if (totalCpuCapacity > 0 || totalRamCapacity > 0) {
      const globalCpu = totalCpuCapacity > 0 ? totalCpuWeighted / totalCpuCapacity : 0
      const globalRam = totalRamCapacity > 0 ? totalRamWeighted / totalRamCapacity : 0
      
      if (isDebugDay) {
      }
      
      result.set(day, {
        cpu: Math.round(globalCpu * 10) / 10,
        ram: Math.round(globalRam * 10) / 10,
        nodeCount: Math.max(nodesWithCpu, nodesWithRam)
      })
    }
  }
  
  
  return result
}

// Calculer les tendances (variation sur la période)
function calculateTrend(values: number[]): number {
  if (values.length < 2) return 0
  
  // Comparer la moyenne de la première moitié vs la deuxième moitié
  const mid = Math.floor(values.length / 2)
  const firstHalf = values.slice(0, mid)
  const secondHalf = values.slice(mid)
  
  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length
  const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length
  
  return Math.round((avgSecond - avgFirst) * 10) / 10
}

// Configuration Green IT par défaut
const DEFAULT_GREEN_CONFIG = {
  // TDP moyen par cœur CPU (Watts) - serveurs modernes
  tdpPerCore: 10,

  // Consommation RAM par Go (Watts)
  wattsPerGbRam: 0.375,

  // Overhead par serveur (disques, réseau, PSU inefficiency)
  overheadPerNode: 50,

  // Nombre de cœurs moyens par serveur (pour estimer le nombre de serveurs)
  avgCoresPerServer: 64,

  // PUE datacenter (Power Usage Effectiveness) - 1.0 = parfait, 2.0 = double
  pue: 1.4,

  // Facteur d'émission CO₂ par pays (kg CO₂ / kWh)
  co2Factors: {
    france: 0.052,      // Nucléaire majoritaire
    germany: 0.385,     // Mix charbon/renouvelable
    usa: 0.417,         // Mix varié
    uk: 0.233,          // Mix gaz/renouvelable
    europe_avg: 0.276,  // Moyenne européenne
  },

  // Facteur par défaut (France)
  defaultCo2Factor: 0.052,

  // Prix électricité (€/kWh)
  electricityPrice: 0.18,

  // Équivalences pour la pédagogie
  equivalences: {
    kmVoiture: 0.193,     // kg CO₂ par km (voiture moyenne)
    arbreParAn: 25,       // kg CO₂ absorbé par arbre/an
    chargeSmartphone: 0.0085, // kg CO₂ par charge
  }
}

// Construire la config Green à partir des settings de la DB
function buildGreenConfig(dbSettings: any) {
  if (!dbSettings) return DEFAULT_GREEN_CONFIG
  
  return {
    tdpPerCore: dbSettings.serverSpecs?.tdpPerCore || DEFAULT_GREEN_CONFIG.tdpPerCore,
    wattsPerGbRam: dbSettings.serverSpecs?.wattsPerGbRam || DEFAULT_GREEN_CONFIG.wattsPerGbRam,
    overheadPerNode: dbSettings.serverSpecs?.overheadPerServer || DEFAULT_GREEN_CONFIG.overheadPerNode,
    avgCoresPerServer: dbSettings.serverSpecs?.avgCoresPerServer || DEFAULT_GREEN_CONFIG.avgCoresPerServer,
    pue: dbSettings.pue || DEFAULT_GREEN_CONFIG.pue,
    co2Factors: DEFAULT_GREEN_CONFIG.co2Factors,
    defaultCo2Factor: dbSettings.co2Factor || DEFAULT_GREEN_CONFIG.defaultCo2Factor,
    electricityPrice: dbSettings.electricityPrice || DEFAULT_GREEN_CONFIG.electricityPrice,
    equivalences: DEFAULT_GREEN_CONFIG.equivalences,
  }
}

// Calculer les métriques Green IT / RSE
function calculateGreenMetrics(data: {
  cpuUsedPct: number
  totalCpuCapacity: number
  totalRamCapacity: number
  totalStorageCapacity: number
  runningVms: number
  totalVms: number
  efficiency: number
}, greenConfig?: typeof DEFAULT_GREEN_CONFIG): {
  power: {
    current: number      // Watts actuels
    max: number          // Watts max théorique
    monthly: number      // kWh/mois
    yearly: number       // kWh/an
  }
  co2: {
    hourly: number       // kg CO₂/heure
    daily: number        // kg CO₂/jour
    monthly: number      // kg CO₂/mois
    yearly: number       // kg CO₂/an
    factor: number       // Facteur utilisé
    equivalentKmCar: number    // Équivalent km voiture/an
    equivalentTrees: number    // Arbres nécessaires pour compenser
  }
  cost: {
    hourly: number       // €/heure
    daily: number        // €/jour
    monthly: number      // €/mois
    yearly: number       // €/an
    pricePerKwh: number  // Prix utilisé
  }
  efficiency: {
    pue: number          // PUE datacenter
    vmPerKw: number      // VMs par kW
    score: number        // Score green /100
  }
} {
  const { cpuUsedPct, totalCpuCapacity, totalRamCapacity, runningVms, totalVms, efficiency } = data
  const config = greenConfig || DEFAULT_GREEN_CONFIG
  
  // Estimation du nombre de nodes (approximation basée sur les specs moyennes)
  const estimatedNodes = Math.max(1, Math.ceil(totalCpuCapacity / (config.avgCoresPerServer || 64)))
  
  // Calcul de la consommation électrique
  // CPU: TDP × cores × utilisation
  const cpuWatts = config.tdpPerCore * totalCpuCapacity * (cpuUsedPct / 100)
  
  // RAM: Watts par Go
  const ramGb = totalRamCapacity / (1024 * 1024 * 1024)
  const ramWatts = config.wattsPerGbRam * ramGb
  
  // Overhead (disques, réseau, etc.)
  const overheadWatts = config.overheadPerNode * estimatedNodes
  
  // Consommation IT totale
  const itWatts = cpuWatts + ramWatts + overheadWatts
  
  // Avec PUE (inclut refroidissement, etc.)
  const totalWatts = itWatts * config.pue
  
  // Consommation max théorique (100% CPU)
  const maxCpuWatts = config.tdpPerCore * totalCpuCapacity
  const maxWatts = (maxCpuWatts + ramWatts + overheadWatts) * config.pue
  
  // Conversions temporelles
  const wattsToKwhMonth = (w: number) => (w * 24 * 30) / 1000
  const wattsToKwhYear = (w: number) => (w * 24 * 365) / 1000
  
  const monthlyKwh = wattsToKwhMonth(totalWatts)
  const yearlyKwh = wattsToKwhYear(totalWatts)
  
  // Émissions CO₂
  const co2Factor = config.defaultCo2Factor
  const yearlyCo2 = yearlyKwh * co2Factor
  const monthlyCo2 = monthlyKwh * co2Factor
  const dailyCo2 = (totalWatts * 24 / 1000) * co2Factor
  const hourlyCo2 = (totalWatts / 1000) * co2Factor
  
  // Équivalences pédagogiques
  const equivalentKmCar = Math.round(yearlyCo2 / config.equivalences.kmVoiture)
  const equivalentTrees = Math.round(yearlyCo2 / config.equivalences.arbreParAn * 10) / 10
  
  // Coûts électricité
  const pricePerKwh = config.electricityPrice
  const yearlyCost = yearlyKwh * pricePerKwh
  const monthlyCost = monthlyKwh * pricePerKwh
  const dailyCost = (totalWatts * 24 / 1000) * pricePerKwh
  const hourlyCost = (totalWatts / 1000) * pricePerKwh
  
  // Score Green (efficacité énergétique)
  // Basé sur: utilisation des ressources, ratio VMs actives, PUE
  let greenScore = 100
  
  // Pénalité si beaucoup de ressources inutilisées (gaspillage)
  if (cpuUsedPct < 10) greenScore -= 20
  else if (cpuUsedPct < 20) greenScore -= 10
  else if (cpuUsedPct < 30) greenScore -= 5
  
  // Pénalité si trop de VMs arrêtées (ressources réservées mais inutilisées)
  const stoppedRatio = totalVms > 0 ? (totalVms - runningVms) / totalVms : 0

  if (stoppedRatio > 0.5) greenScore -= 15
  else if (stoppedRatio > 0.3) greenScore -= 10
  else if (stoppedRatio > 0.2) greenScore -= 5
  
  // Bonus si bonne efficacité d'allocation
  if (efficiency > 70) greenScore += 10
  else if (efficiency > 50) greenScore += 5
  
  // Pénalité si PUE élevé
  if (config.pue > 1.8) greenScore -= 15
  else if (config.pue > 1.5) greenScore -= 10
  else if (config.pue > 1.3) greenScore -= 5
  else if (config.pue <= 1.2) greenScore += 5 // Très bon PUE
  
  greenScore = Math.max(0, Math.min(100, greenScore))
  
  // VMs par kW (indicateur d'efficacité)
  const kwUsed = totalWatts / 1000
  const vmPerKw = kwUsed > 0 ? Math.round((runningVms / kwUsed) * 10) / 10 : 0
  
  return {
    power: {
      current: Math.round(totalWatts),
      max: Math.round(maxWatts),
      monthly: Math.round(monthlyKwh),
      yearly: Math.round(yearlyKwh),
    },
    co2: {
      hourly: Math.round(hourlyCo2 * 1000) / 1000,
      daily: Math.round(dailyCo2 * 100) / 100,
      monthly: Math.round(monthlyCo2 * 10) / 10,
      yearly: Math.round(yearlyCo2),
      factor: co2Factor,
      equivalentKmCar,
      equivalentTrees,
    },
    cost: {
      hourly: Math.round(hourlyCost * 100) / 100,
      daily: Math.round(dailyCost * 100) / 100,
      monthly: Math.round(monthlyCost),
      yearly: Math.round(yearlyCost),
      pricePerKwh,
    },
    efficiency: {
      pue: config.pue,
      vmPerKw,
      score: greenScore,
    }
  }
}

// Formater les tendances pour le frontend avec les moyennes pondérées
// Affiche jusqu'à 90 jours de données historiques
// Stratégie : filtrer les jours avec trop peu de nodes (données incomplètes)
function formatTrendsForChartWeighted(
  globalAverages: Map<string, { cpu: number, ram: number, nodeCount: number }>,
  storageData: Map<string, number[]>
): { 
  trends: Array<{ t: string, cpu: number, ram: number, storage?: number }>,
  periodStart: string | null,
  periodEnd: string | null,
  daysCount: number
} {
  
  if (globalAverages.size === 0) {
    return { trends: [], periodStart: null, periodEnd: null, daysCount: 0 }
  }
  
  // Trier les jours chronologiquement
  const sortedDays = Array.from(globalAverages.keys()).sort()
  
  
  // Stats sur les nodes pour le debug
  const nodeCounts = sortedDays.map(day => globalAverages.get(day)!.nodeCount)
  const maxNodeCount = Math.max(...nodeCounts)
  
  // Filtrer les jours avec au moins 50% des nodes max pour éviter les données biaisées
  const MIN_NODE_RATIO = 0.5
  const minNodes = Math.max(3, Math.floor(maxNodeCount * MIN_NODE_RATIO))
  
  const validDays = sortedDays.filter(day => {
    const data = globalAverages.get(day)!

    
return data.nodeCount >= minNodes
  })
  
  
  if (validDays.length === 0) {
    // Fallback: prendre tous les jours si le filtre est trop strict
    validDays.push(...sortedDays)
  }
  
  // Prendre les 180 derniers jours (6 mois)
  const MAX_DAYS = 180
  const today = new Date()
  const cutoffDate = new Date(today)

  cutoffDate.setDate(cutoffDate.getDate() - MAX_DAYS)
  const cutoffStr = cutoffDate.toISOString().split('T')[0]
  
  // Filtrer les jours dans la plage de temps
  let recentDays = validDays.filter(day => day >= cutoffStr)
  
  if (recentDays.length === 0) {
    // Pas de données récentes, prendre les derniers jours disponibles
    recentDays = validDays.slice(-MAX_DAYS)
  }
  
  
  if (recentDays.length === 0) {
    return { trends: [], periodStart: null, periodEnd: null, daysCount: 0 }
  }
  
  // Créer un index pour accès rapide
  const dataIndex = new Map<string, { cpu: number, ram: number, nodeCount: number }>()

  for (const day of recentDays) {
    const data = globalAverages.get(day)

    if (data) {
      dataIndex.set(day, data)
    }
  }
  
  const trends: Array<{ t: string, cpu: number, ram: number, storage?: number }> = []
  
  // Trouver la plage de dates à afficher
  const firstDay = new Date(recentDays[0])
  const lastDay = new Date(recentDays[recentDays.length - 1])
  
  // Générer tous les jours entre le premier et le dernier
  const currentDate = new Date(firstDay)
  let lastValidCpu = 0
  let lastValidRam = 0
  let lastValidStorage: number | undefined = undefined
  
  // Trouver la première valeur valide
  const firstData = dataIndex.get(recentDays[0])

  if (firstData) {
    lastValidCpu = firstData.cpu
    lastValidRam = firstData.ram
  }
  
  while (currentDate <= lastDay) {
    const dayKey = currentDate.toISOString().split('T')[0]
    const dayData = dataIndex.get(dayKey)
    
    const label = currentDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
    
    if (dayData) {
      // On a des données pour ce jour
      lastValidCpu = dayData.cpu
      lastValidRam = dayData.ram
      
      const storageDay = storageData.get(dayKey)

      if (storageDay && storageDay.length > 0) {
        lastValidStorage = Math.round(storageDay.reduce((a, b) => a + b, 0) / storageDay.length * 10) / 10
      }
    }
    
    // Toujours ajouter un point (avec la dernière valeur valide si pas de données)
    trends.push({ 
      t: label, 
      cpu: lastValidCpu, 
      ram: lastValidRam, 
      storage: lastValidStorage 
    })
    
    // Passer au jour suivant
    currentDate.setDate(currentDate.getDate() + 1)
  }
  
  
  return {
    trends,
    periodStart: recentDays.length > 0 ? recentDays[0] : null,
    periodEnd: recentDays.length > 0 ? recentDays[recentDays.length - 1] : null,
    daysCount: trends.length
  }
}

// Load resource thresholds from DB (F9)
async function loadResourceThresholds() {
  const DEFAULT_THRESHOLDS = {
    cpu: { warning: 80, critical: 90 },
    ram: { warning: 80, critical: 90 },
    storage: { warning: 80, critical: 90 },
  }

  try {
    const db = getDb()
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?')
    const row = stmt.get('resource_thresholds') as { value: string } | undefined
    if (row?.value) return { ...DEFAULT_THRESHOLDS, ...JSON.parse(row.value) }
  } catch (e: any) {
    if (!e?.message?.includes('no such table')) {
      console.warn('Failed to load resource thresholds:', e?.message)
    }
  }

  return DEFAULT_THRESHOLDS
}

// Save health score snapshot (F8) - one per day
function saveHealthScoreSnapshot(score: number, cpuPct: number, ramPct: number, storagePct: number, connectionId?: string) {
  try {
    const db = getDb()
    const today = new Date().toISOString().split('T')[0]
    const id = `hs_${today}${connectionId ? `_${connectionId}` : ''}`
    const dateKey = connectionId ? `${today}_${connectionId}` : today

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO health_score_history (id, date, score, cpu_pct, ram_pct, storage_pct, connection_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(id, dateKey, Math.round(score), cpuPct, ramPct, storagePct, connectionId || null, new Date().toISOString())
  } catch (e: any) {
    if (!e?.message?.includes('no such table')) {
      console.warn('Failed to save health score:', e?.message)
    }
  }
}

// Load health score history (F8)
function loadHealthScoreHistory(connectionId?: string): Array<{ date: string; score: number; cpu: number; ram: number; storage: number }> {
  try {
    const db = getDb()
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 90)
    const cutoffStr = cutoff.toISOString().split('T')[0]

    let rows: any[]
    if (connectionId) {
      const stmt = db.prepare('SELECT date, score, cpu_pct, ram_pct, storage_pct FROM health_score_history WHERE date >= ? AND connection_id = ? ORDER BY date ASC')
      rows = stmt.all(`${cutoffStr}_${connectionId}`, connectionId)
    } else {
      const stmt = db.prepare('SELECT date, score, cpu_pct, ram_pct, storage_pct FROM health_score_history WHERE date >= ? AND connection_id IS NULL ORDER BY date ASC')
      rows = stmt.all(cutoffStr)
    }

    return rows.map((r: any) => ({
      date: r.date.split('_')[0],
      score: r.score,
      cpu: r.cpu_pct || 0,
      ram: r.ram_pct || 0,
      storage: r.storage_pct || 0,
    }))
  } catch (e: any) {
    return []
  }
}

export async function GET(request: Request) {
  try {
    // Parse query params (F4: connectionId filter)
    const { searchParams } = new URL(request.url)
    const filterConnectionId = searchParams.get('connectionId') || undefined

    // Load settings in parallel
    const [greenSettings, resourceThresholds] = await Promise.all([
      loadGreenSettings(),
      loadResourceThresholds(),
    ])
    const greenConfig = buildGreenConfig(greenSettings)

    // Récupérer toutes les connexions PVE
    const allConnections = await prisma.connection.findMany({
      where: { type: 'pve' },
      select: { id: true, name: true },
    })

    if (!allConnections.length) {
      return NextResponse.json({
        data: {
          kpis: {
            cpu: { used: 0, allocated: 0, total: 0, trend: 0 },
            ram: { used: 0, allocated: 0, total: 0, trend: 0 },
            storage: { used: 0, total: 0, trend: 0 },
            vms: { total: 0, running: 0, stopped: 0 },
            efficiency: 0
          },
          trends: [],
          topCpuVms: [],
          topRamVms: [],
          connections: [],
        }
      })
    }

    // F4: filter by connectionId if specified
    const connections = filterConnectionId
      ? allConnections.filter(c => c.id === filterConnectionId)
      : allConnections

    // Agrégateurs globaux
    let totalCpuUsed = 0
    let totalCpuAllocated = 0
    let totalCpuCapacity = 0
    let totalRamUsed = 0
    let totalRamAllocated = 0
    let totalRamCapacity = 0
    let totalStorageUsed = 0
    let totalStorageCapacity = 0
    let totalVms = 0
    let runningVms = 0
    let stoppedVms = 0
    
    // Pour les données RRD agrégées par node
    const allNodesRrdData = new Map<string, Map<string, { cpu: number[], ram: number[] }>>()
    const nodeCapacities = new Map<string, { maxCpu: number, maxMem: number }>()
    const globalStorageByDay = new Map<string, number[]>()
    const allCpuValues: number[] = []
    const allRamValues: number[] = []
    const allStorageValues: number[] = []

    // F5: Storage pool tracking
    const storagePoolMap = new Map<string, { name: string; type: string; used: number; total: number; nodes: Set<string> }>()

    // F6: Network metrics tracking (keyed by connId:nodeName to avoid collisions)
    const networkPerNode = new Map<string, { name: string; netin: number; netout: number }>()
    // Track per-node-per-day for proper aggregation: day -> nodeKey -> data points
    const networkTrendsByDay = new Map<string, Map<string, { netin: number[]; netout: number[] }>>()

    const allVms: Array<{
      id: string
      name: string
      node: string
      connName: string
      cpu: number
      ram: number
      cpuAllocated: number
      ramAllocated: number
      status: string
      netin: number
      netout: number
    }> = []

    // Collecter les données de toutes les connexions
    await Promise.all(
      connections.map(async (conn) => {
        try {
          const connData = await getConnectionById(conn.id)
          
          // Récupérer nodes et VMs en parallèle (avec timeout per-request)
          const rTimeout = { signal: AbortSignal.timeout(15000) }

          const [nodesResult, vmsResult, storageResult] = await Promise.allSettled([
            pveFetch<NodeData[]>(connData, '/nodes', rTimeout),
            pveFetch<VmData[]>(connData, '/cluster/resources?type=vm', rTimeout),
            pveFetch<any[]>(connData, '/cluster/resources?type=storage', rTimeout),
          ])
          
          const nodes = nodesResult.status === 'fulfilled' ? nodesResult.value || [] : []
          const vms = vmsResult.status === 'fulfilled' ? vmsResult.value || [] : []
          const storages = storageResult.status === 'fulfilled' ? storageResult.value || [] : []
          
          // Agréger les nodes (données synchrones) et préparer les requêtes RRD
          const onlineNodes = nodes.filter(node => node.status === 'online')

          for (const node of onlineNodes) {
            const nodeMaxCpu = node.maxcpu || 0
            const nodeMaxMem = node.maxmem || 0
            const nodeKey = `${conn.id}:${node.node}`

            totalCpuCapacity += nodeMaxCpu
            totalCpuUsed += (node.cpu || 0) * nodeMaxCpu
            totalRamCapacity += nodeMaxMem
            totalRamUsed += node.mem || 0

            // Stocker la capacité du node
            nodeCapacities.set(nodeKey, { maxCpu: nodeMaxCpu, maxMem: nodeMaxMem })
          }

          // Récupérer les données RRD de tous les nodes en parallèle
          const rrdTimeout = { signal: AbortSignal.timeout(10000) }

          // RRD year (CPU/RAM trends) + RRD month (Network I/O, higher resolution) in parallel
          const [nodeRrdResults, nodeRrdMonthResults] = await Promise.all([
            Promise.allSettled(
              onlineNodes.map(node =>
                pveFetch<RrdPoint[]>(
                  connData,
                  `/nodes/${encodeURIComponent(node.node)}/rrddata?timeframe=year&cf=AVERAGE`,
                  rrdTimeout
                )
              )
            ),
            Promise.allSettled(
              onlineNodes.map(node =>
                pveFetch<RrdPoint[]>(
                  connData,
                  `/nodes/${encodeURIComponent(node.node)}/rrddata?timeframe=month&cf=AVERAGE`,
                  rrdTimeout
                )
              )
            ),
          ])

          // Traiter les résultats RRD des nodes (year — CPU/RAM)
          for (let i = 0; i < onlineNodes.length; i++) {
            const node = onlineNodes[i]
            const nodeKey = `${conn.id}:${node.node}`
            const nodeMaxCpu = node.maxcpu || 0
            const nodeMaxMem = node.maxmem || 0
            const result = nodeRrdResults[i]

            if (result.status === 'fulfilled' && result.value && result.value.length > 0) {
              const nodeRrdByDay = aggregateRrdByDayPerNode(result.value, nodeKey, nodeMaxCpu, nodeMaxMem)

              allNodesRrdData.set(nodeKey, nodeRrdByDay)

              // Collecter toutes les valeurs pour le calcul des tendances globales
              for (const dayData of nodeRrdByDay.values()) {
                allCpuValues.push(...dayData.cpu)
                allRamValues.push(...dayData.ram)
              }
            } else if (result.status === 'rejected') {
              console.warn(`[resources] RRD year error for node ${node.node}:`, result.reason)
            }
          }

          // F6: Traiter les résultats RRD des nodes (month — Network I/O, ~12h resolution)
          for (let i = 0; i < onlineNodes.length; i++) {
            const node = onlineNodes[i]
            const netNodeKey = `${conn.id}:${node.node}`
            const result = nodeRrdMonthResults[i]

            if (result.status === 'fulfilled' && result.value && result.value.length > 0) {
              let nodeNetIn = 0, nodeNetOut = 0, netPoints = 0
              for (const point of result.value) {
                if (!point.time) continue
                const netin = Number(point.netin ?? 0)
                const netout = Number(point.netout ?? 0)
                if (netin > 0 || netout > 0) {
                  nodeNetIn += netin
                  nodeNetOut += netout
                  netPoints++

                  const dayKey = new Date(point.time * 1000).toISOString().split('T')[0]
                  if (!networkTrendsByDay.has(dayKey)) networkTrendsByDay.set(dayKey, new Map())
                  const dayNodes = networkTrendsByDay.get(dayKey)!
                  if (!dayNodes.has(netNodeKey)) dayNodes.set(netNodeKey, { netin: [], netout: [] })
                  const nodeDay = dayNodes.get(netNodeKey)!
                  nodeDay.netin.push(netin)
                  nodeDay.netout.push(netout)
                }
              }
              if (netPoints > 0) {
                networkPerNode.set(netNodeKey, {
                  name: node.node,
                  netin: nodeNetIn / netPoints,
                  netout: nodeNetOut / netPoints,
                })
              }
            } else if (result.status === 'rejected') {
              console.warn(`[resources] RRD month error for node ${node.node}:`, result.reason)
            }
          }
          
          // Agréger le stockage (données synchrones) et préparer les requêtes RRD
          const availableStorages = storages.filter(s => s.status === 'available')

          for (const storage of availableStorages) {
            totalStorageCapacity += storage.maxdisk || 0
            totalStorageUsed += storage.disk || 0

            // F5: Aggregate by pool name
            if (storage.storage) {
              const poolKey = storage.storage
              if (!storagePoolMap.has(poolKey)) {
                storagePoolMap.set(poolKey, {
                  name: poolKey,
                  type: storage.plugintype || storage.type || 'unknown',
                  used: 0,
                  total: 0,
                  nodes: new Set(),
                })
              }
              const pool = storagePoolMap.get(poolKey)!
              pool.used += storage.disk || 0
              pool.total += storage.maxdisk || 0
              if (storage.node) pool.nodes.add(storage.node)
            }
          }

          // Identifier les storages qui ont besoin de requêtes RRD
          const storagesNeedingRrd = availableStorages.filter(
            s => s.maxdisk > 0 && s.node && s.storage
          )

          // Récupérer les données RRD de tous les storages en parallèle
          const storageRrdResults = await Promise.allSettled(
            storagesNeedingRrd.map(storage =>
              pveFetch<RrdPoint[]>(
                connData,
                `/nodes/${encodeURIComponent(storage.node)}/storage/${encodeURIComponent(storage.storage)}/rrddata?timeframe=year&cf=AVERAGE`,
                rrdTimeout
              )
            )
          )

          // Traiter les résultats RRD des storages
          for (const storage of availableStorages) {
            if (storage.maxdisk > 0) {
              const storagePct = (storage.disk / storage.maxdisk) * 100

              allStorageValues.push(storagePct)

              // Fallback: ajouter la valeur actuelle pour aujourd'hui
              const today = new Date().toISOString().split('T')[0]

              if (!globalStorageByDay.has(today)) {
                globalStorageByDay.set(today, [])
              }

              globalStorageByDay.get(today)!.push(storagePct)
            }
          }

          // Traiter les résultats RRD des storages
          for (let i = 0; i < storagesNeedingRrd.length; i++) {
            const storage = storagesNeedingRrd[i]
            const result = storageRrdResults[i]

            if (result.status === 'fulfilled' && result.value && result.value.length > 0) {
              for (const point of result.value) {
                if (!point.time) continue

                const date = new Date(point.time * 1000)
                const dayKey = date.toISOString().split('T')[0]

                // Utiliser total et used du RRD si disponibles
                const used = Number(point.used ?? 0)
                const total = Number(point.total ?? storage.maxdisk ?? 0)

                if (used > 0 && total > 0) {
                  const pct = (used / total) * 100

                  if (pct >= 0 && pct <= 100) {
                    if (!globalStorageByDay.has(dayKey)) {
                      globalStorageByDay.set(dayKey, [])
                    }

                    globalStorageByDay.get(dayKey)!.push(pct)
                  }
                }
              }
            }
            // Silently ignore rejected - storage RRD might not be available
          }
          
          // Agréger les VMs
          for (const vm of vms) {
            totalVms++

            if (vm.status === 'running') {
              runningVms++
              totalCpuAllocated += vm.maxcpu || 0
              totalRamAllocated += vm.maxmem || 0
            } else if (vm.status === 'stopped') {
              stoppedVms++
            }
            
            // Calculer l'utilisation de la VM
            const cpuPct = vm.status === 'running' ? Math.round((vm.cpu || 0) * 100) : 0

            const ramPct = vm.status === 'running' && vm.maxmem 
              ? Math.round(((vm.mem || 0) / vm.maxmem) * 100) 
              : 0
            
            allVms.push({
              id: `${conn.id}:${vm.type}:${vm.node}:${vm.vmid}`,
              name: vm.name || `${vm.type}/${vm.vmid}`,
              node: vm.node,
              connName: conn.name,
              cpu: cpuPct,
              ram: ramPct,
              cpuAllocated: vm.maxcpu || 0,
              ramAllocated: vm.maxmem || 0,
              status: vm.status,
              netin: (vm as any).netin || 0,
              netout: (vm as any).netout || 0,
            })
          }
        } catch (e) {
          console.error(`[resources] Error fetching ${conn.name}:`, e)
        }
      })
    )

    // Calculer les pourcentages globaux actuels
    const cpuUsedPct = totalCpuCapacity > 0 ? (totalCpuUsed / totalCpuCapacity) * 100 : 0
    const ramUsedPct = totalRamCapacity > 0 ? (totalRamUsed / totalRamCapacity) * 100 : 0
    const storageUsedPct = totalStorageCapacity > 0 ? (totalStorageUsed / totalStorageCapacity) * 100 : 0
    
    // Calculer les tendances réelles à partir des données RRD
    const cpuTrend = calculateTrend(allCpuValues)
    const ramTrend = calculateTrend(allRamValues)
    const storageTrend = calculateTrend(allStorageValues)
    
    // Score d'efficacité
    const cpuEfficiency = totalCpuAllocated > 0 
      ? Math.min(100, (cpuUsedPct / (totalCpuAllocated / totalCpuCapacity * 100)) * 100) 
      : 100

    const ramEfficiency = totalRamAllocated > 0 
      ? Math.min(100, (ramUsedPct / (totalRamAllocated / totalRamCapacity * 100)) * 100) 
      : 100

    const efficiency = Math.round((cpuEfficiency + ramEfficiency) / 2)
    
    // Top VMs par CPU et RAM (running uniquement)
    const runningVmsList = allVms.filter(vm => vm.status === 'running')

    const topCpuVms = [...runningVmsList]
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 10)

    const topRamVms = [...runningVmsList]
      .sort((a, b) => b.ram - a.ram)
      .slice(0, 10)

    // ===== Calcul des données d'Overprovisioning =====
    // Convertir RAM de bytes en GB pour l'affichage
    const totalRamAllocatedGB = totalRamAllocated / (1024 * 1024 * 1024)
    const totalRamCapacityGB = totalRamCapacity / (1024 * 1024 * 1024)
    const totalRamUsedGB = totalRamUsed / (1024 * 1024 * 1024)

    // Calculer l'utilisation CPU réelle (vCPUs utilisés = pCPUs utilisés car CPU est un ratio)
    const cpuUsedVcpus = (cpuUsedPct / 100) * totalCpuCapacity

    // Ratios d'overprovisioning
    const cpuOverprovisioningRatio = totalCpuCapacity > 0 ? totalCpuAllocated / totalCpuCapacity : 0
    const ramOverprovisioningRatio = totalRamCapacityGB > 0 ? totalRamAllocatedGB / totalRamCapacityGB : 0

    // Efficacité (utilisation réelle / allocation)
    const cpuAllocationEfficiency = totalCpuAllocated > 0 ? (cpuUsedVcpus / totalCpuAllocated) * 100 : 0
    const ramAllocationEfficiency = totalRamAllocatedGB > 0 ? (totalRamUsedGB / totalRamAllocatedGB) * 100 : 0

    // Données par nœud
    const perNodeOverprovisioning = Array.from(nodeCapacities.entries()).map(([compositeKey, capacity]) => {
      // compositeKey = "connId:pveNodeName" — extract actual PVE node name
      const actualNodeName = compositeKey.includes(':') ? compositeKey.split(':').slice(1).join(':') : compositeKey
      // Calculer les allocations par nœud
      const nodeVms = allVms.filter(vm => vm.node === actualNodeName && vm.status === 'running')
      const nodeCpuAllocated = nodeVms.reduce((sum, vm) => sum + (vm.cpuAllocated || 0), 0)
      const nodeRamAllocated = nodeVms.reduce((sum, vm) => sum + (vm.ramAllocated || 0), 0) / (1024 * 1024 * 1024)
      const nodeRamCapacity = capacity.maxMem / (1024 * 1024 * 1024)

      return {
        name: actualNodeName,
        cpuRatio: capacity.maxCpu > 0 ? nodeCpuAllocated / capacity.maxCpu : 0,
        ramRatio: nodeRamCapacity > 0 ? nodeRamAllocated / nodeRamCapacity : 0,
        cpuAllocated: nodeCpuAllocated,
        cpuPhysical: capacity.maxCpu,
        ramAllocated: nodeRamAllocated,
        ramPhysical: nodeRamCapacity
      }
    })

    // VMs sur-provisionnées (candidats au rightsizing)
    const MIN_CPU_SAVINGS = 2  // Minimum 2 vCPUs à économiser pour être listé
    const MIN_RAM_SAVINGS_GB = 2  // Minimum 2 GB à économiser

    const topOverprovisioned = runningVmsList
      .map(vm => {
        const cpuAllocated = vm.cpuAllocated || 0
        const cpuUsedPct = vm.cpu || 0
        const ramAllocatedBytes = vm.ramAllocated || 0
        const ramAllocatedGB = ramAllocatedBytes / (1024 * 1024 * 1024)
        const ramUsedPct = vm.ram || 0

        // Calculer les recommandations (utilisation + 30% marge pour CPU, 20% pour RAM)
        const recommendedCpu = Math.max(1, Math.ceil(cpuAllocated * (cpuUsedPct / 100) * 1.3))
        const recommendedRamGB = Math.max(1, Math.ceil(ramAllocatedGB * (ramUsedPct / 100) * 1.2))

        // Calculer les économies potentielles
        const cpuSavings = Math.max(0, cpuAllocated - recommendedCpu)
        const ramSavingsGB = Math.max(0, ramAllocatedGB - recommendedRamGB)

        // Extraire le VMID numérique depuis l'ID composite (connId:type:node:vmid)
        const numericVmid = vm.id.split(':').pop() || vm.id

        return {
          vmid: numericVmid,
          name: vm.name,
          node: vm.node,
          cpuAllocated,
          cpuUsedPct,
          ramAllocatedGB,
          ramUsedPct,
          recommendedCpu,
          recommendedRamGB,
          potentialSavings: { cpu: cpuSavings, ramGB: ramSavingsGB },

          // Score de priorité pour le tri (plus c'est haut, plus c'est important)
          priorityScore: cpuSavings * 10 + ramSavingsGB
        }
      })
      .filter(vm => vm.potentialSavings.cpu >= MIN_CPU_SAVINGS || vm.potentialSavings.ramGB >= MIN_RAM_SAVINGS_GB)
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, 10)
      .map(({ priorityScore, ...vm }) => vm)  // Retirer priorityScore du résultat

    const overprovisioningData = {
      cpu: {
        allocated: totalCpuAllocated,
        used: Math.round(cpuUsedVcpus * 10) / 10,
        physical: totalCpuCapacity,
        ratio: Math.round(cpuOverprovisioningRatio * 100) / 100,
        efficiency: Math.round(cpuAllocationEfficiency * 10) / 10
      },
      ram: {
        allocated: Math.round(totalRamAllocatedGB * 10) / 10,
        used: Math.round(totalRamUsedGB * 10) / 10,
        physical: Math.round(totalRamCapacityGB * 10) / 10,
        ratio: Math.round(ramOverprovisioningRatio * 100) / 100,
        efficiency: Math.round(ramAllocationEfficiency * 10) / 10
      },
      perNode: perNodeOverprovisioning,
      topOverprovisioned
    }
    
    // Calculer les moyennes pondérées globales à partir des données de tous les nodes
    const globalAverages = calculateGlobalAverages(allNodesRrdData, nodeCapacities)
    
    // Générer les tendances formatées pour le graphique
    const trendsResult = formatTrendsForChartWeighted(globalAverages, globalStorageByDay)
    let trends = trendsResult.trends
    let periodStart = trendsResult.periodStart
    let periodEnd = trendsResult.periodEnd
    
    // Si on n'a pas assez de données RRD, compléter avec les valeurs actuelles
    if (trends.length === 0) {
      const today = new Date()

      periodEnd = today.toISOString().split('T')[0]
      const startDate = new Date(today)

      startDate.setDate(startDate.getDate() - 29)
      periodStart = startDate.toISOString().split('T')[0]
      
      for (let i = 29; i >= 0; i--) {
        const date = new Date(today)

        date.setDate(date.getDate() - i)
        trends.push({
          t: date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
          cpu: Math.round(cpuUsedPct * 10) / 10,
          ram: Math.round(ramUsedPct * 10) / 10,
          storage: Math.round(storageUsedPct * 10) / 10,
        })
      }
    }

    // F5: Build storage pools array
    const storagePools = Array.from(storagePoolMap.values()).map(pool => ({
      name: pool.name,
      type: pool.type,
      used: pool.used,
      total: pool.total,
      pct: pool.total > 0 ? Math.round((pool.used / pool.total) * 1000) / 10 : 0,
      nodes: Array.from(pool.nodes),
    })).sort((a, b) => b.pct - a.pct)

    // F6: Build network metrics
    const totalNetIn = Array.from(networkPerNode.values()).reduce((s, n) => s + n.netin, 0)
    const totalNetOut = Array.from(networkPerNode.values()).reduce((s, n) => s + n.netout, 0)

    // F6: Network trends (last 30 days) — sum per-node averages for proper aggregation
    const sortedNetDays = Array.from(networkTrendsByDay.keys()).sort().slice(-30)
    const networkTrends = sortedNetDays.map(day => {
      const dayNodes = networkTrendsByDay.get(day)!
      let dayNetin = 0, dayNetout = 0
      // For each node on this day, compute the node's average, then sum across nodes
      for (const nodeData of dayNodes.values()) {
        dayNetin += nodeData.netin.reduce((a, b) => a + b, 0) / nodeData.netin.length
        dayNetout += nodeData.netout.reduce((a, b) => a + b, 0) / nodeData.netout.length
      }
      return {
        t: new Date(day).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
        netin: dayNetin,
        netout: dayNetout,
      }
    })

    // F6: Top VMs by network traffic
    const topNetworkVms = [...allVms]
      .filter(vm => vm.status === 'running' && (vm.netin > 0 || vm.netout > 0))
      .sort((a, b) => (b.netin + b.netout) - (a.netin + a.netout))
      .slice(0, 5)
      .map(vm => ({ id: vm.id, name: vm.name, node: vm.node, netin: vm.netin, netout: vm.netout }))

    const networkMetrics = (totalNetIn > 0 || totalNetOut > 0 || networkTrends.length > 0) ? {
      totalIn: totalNetIn,
      totalOut: totalNetOut,
      perNode: Array.from(networkPerNode.values()),
      trends: networkTrends,
      topVms: topNetworkVms,
    } : null

    // F8: Save health score snapshot (simple estimate for storage)
    const healthCpuPct = Math.round(cpuUsedPct * 10) / 10
    const healthRamPct = Math.round(ramUsedPct * 10) / 10
    const healthStoragePct = Math.round(storageUsedPct * 10) / 10

    // Simple health score estimate for snapshot (matches frontend algorithm roughly)
    let snapshotScore = 100
    if (healthCpuPct > 90) snapshotScore -= 30
    else if (healthCpuPct > 80) snapshotScore -= 15
    else if (healthCpuPct > 70) snapshotScore -= 5
    if (healthRamPct > 90) snapshotScore -= 30
    else if (healthRamPct > 80) snapshotScore -= 15
    else if (healthRamPct > 70) snapshotScore -= 5
    if (healthStoragePct > 90) snapshotScore -= 20
    else if (healthStoragePct > 80) snapshotScore -= 10
    snapshotScore = Math.max(0, Math.min(100, snapshotScore))

    saveHealthScoreSnapshot(snapshotScore, healthCpuPct, healthRamPct, healthStoragePct, filterConnectionId)

    // F8: Load history
    const healthScoreHistory = loadHealthScoreHistory(filterConnectionId)

    return NextResponse.json({
      data: {
        kpis: {
          cpu: {
            used: healthCpuPct,
            allocated: totalCpuAllocated,
            total: totalCpuCapacity,
            trend: cpuTrend
          },
          ram: {
            used: healthRamPct,
            allocated: totalRamAllocated,
            total: totalRamCapacity,
            trend: ramTrend
          },
          storage: {
            used: totalStorageUsed,
            total: totalStorageCapacity,
            trend: storageTrend
          },
          vms: { total: totalVms, running: runningVms, stopped: stoppedVms },
          efficiency
        },
        trends,
        trendsPeriod: {
          start: periodStart,
          end: periodEnd,
          daysCount: trends.length
        },
        topCpuVms,
        topRamVms,

        // Données d'Overprovisioning
        overprovisioning: overprovisioningData,

        // Indicateurs RSE / Green IT
        green: calculateGreenMetrics({
          cpuUsedPct,
          totalCpuCapacity,
          totalRamCapacity,
          totalStorageCapacity,
          runningVms,
          totalVms,
          efficiency
        }, greenConfig),

        // F5: Storage per pool
        storagePools,

        // F6: Network I/O
        networkMetrics,

        // F8: Health score history
        healthScoreHistory,

        // F9: Resource thresholds
        thresholds: resourceThresholds,

        // F4: Connections list for drill-down
        connections: allConnections.map(c => ({ id: c.id, name: c.name })),

        // Métadonnées pour debug
        _meta: {
          connectionsCount: connections.length,
          nodesCount: nodeCapacities.size,
          nodesInfo: Array.from(nodeCapacities.entries()).map(([name, cap]) => ({
            name,
            maxCpu: cap.maxCpu,
            maxMem: Math.round(cap.maxMem / 1024 / 1024 / 1024) + ' GB',
            rrdDays: allNodesRrdData.get(name)?.size || 0
          })),
          rrdDaysAvailable: globalAverages.size,
          trendsCount: trends.length,
          dataSource: globalAverages.size > 0 ? 'rrd_weighted' : 'fallback',
          filteredByConnection: filterConnectionId || null,

          // Plage de données
          dateRange: trends.length > 0 ? {
            first: trends[0].t,
            last: trends[trends.length - 1].t
          } : null
        }
      }
    })
  } catch (e: any) {
    console.error("[resources/overview] Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
