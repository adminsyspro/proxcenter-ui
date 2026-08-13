import { NextResponse } from "next/server"

import { formatBytes } from "@/utils/format"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getRequestLocale, jsonLanguageInstruction, normalizeLocale } from "@/lib/ai/locale"

export const runtime = "nodejs"

/**
 * POST /api/v1/resources/analyze
 * 
 * Analyse les ressources avec Ollama local et génère des recommandations
 * 
 * Variables d'environnement:
 * - OLLAMA_URL: URL du serveur Ollama (ex: http://localhost:11434)
 * - OLLAMA_MODEL: Modèle à utiliser (ex: llama3, mistral, qwen2.5)
 */

type KpiData = {
  cpu: { used: number; allocated: number; total: number; trend: number }
  ram: { used: number; allocated: number; total: number; trend: number }
  storage: { used: number; total: number; trend: number }
  vms: { total: number; running: number; stopped: number }
  efficiency: number
}

type TopVm = {
  id: string
  name: string
  node: string
  cpu: number
  ram: number
  cpuAllocated: number
  ramAllocated: number
}

type Recommendation = {
  id: string
  type: string
  severity: 'high' | 'medium' | 'low' | 'info'
  title: string
  description: string
  savings?: string
  vmId?: string
  vmName?: string
  titleKey?: string
  descriptionKey?: string
  savingsKey?: string
  params?: Record<string, string | number>
}

// Appeler Ollama pour l'analyse
async function callOllama(prompt: string): Promise<string> {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434'
  const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.1:8b'
  
  // Essayer d'abord /api/chat (format plus récent)
  try {
    const chatResponse = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 1024
        }
      })
    })
    
    if (chatResponse.ok) {
      const data = await chatResponse.json()

      
return data.message?.content || ''
    }
  } catch (e) {
    // /api/chat failed, trying /api/generate
  }
  
  // Fallback sur /api/generate (ancien format)
  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel,
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.3,
        num_predict: 1024
      }
    })
  })
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')

    console.error(`[resources/analyze] Ollama error ${response.status}: ${errorText}`)
    throw new Error(`Ollama error: ${response.status} - ${errorText || 'Model not found?'}`)
  }
  
  const data = await response.json()

  
return data.response || ''
}

// Vérifier si Ollama est disponible
async function isOllamaAvailable(): Promise<boolean> {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434'
  
  try {
    const response = await fetch(`${ollamaUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000) // 2s timeout
    })

    
return response.ok
  } catch {
    return false
  }
}

// #686: this prompt used to be written entirely in French, so the summary
// and recommendations rendered by AiInsightsCard came back in French for
// every user whatever their UI language. The prompt is now authored in
// English and carries an explicit language instruction derived from the UI
// locale. The reply is JSON-parsed below, so the instruction must keep the
// keys in English and only translate the human-readable values.
function buildPrompt(kpis: KpiData, topCpuVms: TopVm[], topRamVms: TopVm[], locale: string): string {
  return `You are an expert in Proxmox infrastructure optimization. Analyze the following data and provide recommendations.

## Infrastructure data

### Global KPIs
- CPU: ${kpis.cpu.used.toFixed(1)}% used (${kpis.cpu.allocated} vCPUs allocated out of ${kpis.cpu.total} available)
- RAM: ${kpis.ram.used.toFixed(1)}% used (${formatBytes(kpis.ram.allocated)} allocated out of ${formatBytes(kpis.ram.total)} available)
- Storage: ${((kpis.storage.used / kpis.storage.total) * 100).toFixed(1)}% used (${formatBytes(kpis.storage.used)} out of ${formatBytes(kpis.storage.total)})
- VMs: ${kpis.vms.total} total (${kpis.vms.running} running, ${kpis.vms.stopped} stopped)
- Efficiency score: ${kpis.efficiency}%

### Trends
- CPU: ${kpis.cpu.trend >= 0 ? '+' : ''}${kpis.cpu.trend}% over 7 days
- RAM: ${kpis.ram.trend >= 0 ? '+' : ''}${kpis.ram.trend}% over 7 days
- Storage: ${kpis.storage.trend >= 0 ? '+' : ''}${kpis.storage.trend}% over 7 days

### Top 5 CPU-consuming VMs
${topCpuVms.slice(0, 5).map((vm, i) => `${i + 1}. ${vm.name} (${vm.node}): ${vm.cpu}% CPU, ${vm.cpuAllocated} vCPUs`).join('\n')}

### Top 5 RAM-consuming VMs
${topRamVms.slice(0, 5).map((vm, i) => `${i + 1}. ${vm.name} (${vm.node}): ${vm.ram}% RAM, ${formatBytes(vm.ramAllocated)}`).join('\n')}

## Instructions

Reply ONLY with valid JSON (no markdown, no backticks, no text before or after) using this exact structure:
{
  "summary": "A 2-3 sentence summary of the state of the infrastructure",
  "recommendations": [
    {
      "id": "rec_1, then rec_2, rec_3 ... one distinct id per recommendation",
      "type": "overprovisioned|underused|stopped|prediction|optimization",
      "severity": "high|medium|low|info",
      "title": "Short title",
      "description": "Detailed description",
      "savings": "Potential saving (optional)",
      "vmName": "Name of the VM concerned, copied character for character from the data above (optional)"
    }
  ]
}

Generate between 3 and 6 relevant recommendations based on the data.

"type" and "severity" are enumerations consumed by code: use one of the listed values, in English. "id" must be unique per recommendation. "vmName" identifies a real guest and must be copied verbatim, never translated. Only "summary", "title", "description" and "savings" are read by a human.

${jsonLanguageInstruction(locale)}`
}

export async function POST(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const body = await req.json()

    const { kpis, topCpuVms, topRamVms, locale: bodyLocale } = body as {
      kpis: KpiData
      topCpuVms: TopVm[]
      topRamVms: TopVm[]
      locale?: string
    }

    if (!kpis) {
      return NextResponse.json({ error: "Missing KPI data" }, { status: 400 })
    }

    // Same idiom as the two chat routes: the caller's locale when it sends
    // one, the request's otherwise. `normalizeLocale` narrows a
    // caller-controlled value to a supported locale before it reaches the
    // prompt.
    const locale = bodyLocale ? normalizeLocale(bodyLocale) : await getRequestLocale()
    const prompt = buildPrompt(kpis, topCpuVms || [], topRamVms || [], locale)
    
    // Essayer Ollama, sinon fallback basique
    const ollamaAvailable = await isOllamaAvailable()
    
    let responseText = ''
    let provider = 'basic'
    
    if (ollamaAvailable) {
      // Utiliser Ollama
      try {
        responseText = await callOllama(prompt)
        provider = 'ollama'
      } catch (e) {
        console.error('[resources/analyze] Ollama error:', e)
      }
    }
    
    if (!responseText) {
      // Fallback sur recommandations basiques (silencieux - normal sans Ollama)
      const basic = generateBasicRecommendations(kpis, topCpuVms || [], topRamVms || [])

      return NextResponse.json({
        data: { ...basic, provider: 'basic' }
      })
    }

    // Parser le JSON de la réponse
    let analysis

    try {
      const cleanedText = responseText
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim()

      // Extraire le JSON si entouré d'autre texte
      const jsonMatch = cleanedText.match(/\{[\s\S]*\}/)

      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('No JSON found')
      }
    } catch (parseError) {
      console.error("[resources/analyze] JSON parse error:", parseError)
      const basic = generateBasicRecommendations(kpis, topCpuVms || [], topRamVms || [])

      return NextResponse.json({
        data: { ...basic, provider: 'basic' }
      })
    }

    return NextResponse.json({
      data: {
        summary: analysis.summary || '',
        recommendations: analysis.recommendations || [],
        provider
      }
    })
  } catch (e: any) {
    console.error("[resources/analyze] Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// Générer des recommandations basiques sans IA
// Returns i18n keys + params instead of hardcoded text — the frontend resolves them with t()
function generateBasicRecommendations(
  kpis: KpiData,
  topCpuVms: TopVm[],
  topRamVms: TopVm[]
): { summary: string; summaryKey: string; summaryParams: Record<string, string | number>; recommendations: Recommendation[] } {
  const recommendations: Recommendation[] = []

  // Analyse CPU
  if (kpis.cpu.used > 80) {
    recommendations.push({
      id: 'rec_cpu_high',
      type: 'prediction',
      severity: 'high',
      title: '', description: '',
      titleKey: 'resources.rec.cpuHighTitle',
      descriptionKey: 'resources.rec.cpuHighDesc',
      params: { usage: kpis.cpu.used.toFixed(1) }
    })
  } else if (kpis.cpu.used < 20 && kpis.cpu.allocated > kpis.cpu.total * 0.5) {
    recommendations.push({
      id: 'rec_cpu_over',
      type: 'overprovisioned',
      severity: 'medium',
      title: '', description: '',
      titleKey: 'resources.rec.cpuOverTitle',
      descriptionKey: 'resources.rec.cpuOverDesc',
      savingsKey: 'resources.rec.cpuOverSavings',
      params: { usage: kpis.cpu.used.toFixed(1), allocated: kpis.cpu.allocated }
    })
  }

  // Analyse RAM
  if (kpis.ram.used > 85) {
    recommendations.push({
      id: 'rec_ram_high',
      type: 'prediction',
      severity: 'high',
      title: '', description: '',
      titleKey: 'resources.rec.ramHighTitle',
      descriptionKey: 'resources.rec.ramHighDesc',
      params: { usage: kpis.ram.used.toFixed(1) }
    })
  }

  // Analyse stockage
  const storagePct = (kpis.storage.used / kpis.storage.total) * 100
  if (storagePct > 80) {
    recommendations.push({
      id: 'rec_storage_high',
      type: 'prediction',
      severity: 'high',
      title: '', description: '',
      titleKey: 'resources.rec.storageHighTitle',
      descriptionKey: 'resources.rec.storageHighDesc',
      params: { usage: storagePct.toFixed(1) }
    })
  }

  // VMs arrêtées
  if (kpis.vms.stopped > 5) {
    recommendations.push({
      id: 'rec_vms_stopped',
      type: 'stopped',
      severity: 'low',
      title: '', description: '',
      titleKey: 'resources.rec.stoppedTitle',
      descriptionKey: 'resources.rec.stoppedDesc',
      savingsKey: 'resources.rec.stoppedSavings',
      params: { count: kpis.vms.stopped }
    })
  }

  // Top VM CPU sous-utilisée
  const underusedCpu = topCpuVms.find(vm => vm.cpu < 10 && vm.cpuAllocated >= 4)

  if (underusedCpu) {
    recommendations.push({
      id: 'rec_vm_cpu_underused',
      type: 'underused',
      severity: 'medium',
      title: '', description: '',
      titleKey: 'resources.rec.cpuUnderusedTitle',
      descriptionKey: 'resources.rec.cpuUnderusedDesc',
      savingsKey: 'resources.rec.cpuUnderusedSavings',
      vmName: underusedCpu.name,
      params: { vmName: underusedCpu.name, cpu: underusedCpu.cpu, allocated: underusedCpu.cpuAllocated, reclaimable: Math.floor(underusedCpu.cpuAllocated / 2) }
    })
  }

  // Score d'efficacité
  if (kpis.efficiency < 50) {
    recommendations.push({
      id: 'rec_efficiency',
      type: 'optimization',
      severity: 'medium',
      title: '', description: '',
      titleKey: 'resources.rec.efficiencyTitle',
      descriptionKey: 'resources.rec.efficiencyDesc',
      params: { score: kpis.efficiency }
    })
  }

  // Build summary key
  const highCount = recommendations.filter(r => r.severity === 'high').length
  let summaryKey: string
  let summaryParams: Record<string, string | number> = {
    total: kpis.vms.total,
    running: kpis.vms.running,
    efficiency: kpis.efficiency,
  }

  if (highCount > 0) {
    summaryKey = kpis.efficiency >= 70 ? 'resources.rec.summaryGoodWithCritical' : 'resources.rec.summaryBadWithCritical'
    summaryParams.criticalCount = highCount
  } else if (recommendations.length > 0) {
    summaryKey = kpis.efficiency >= 70 ? 'resources.rec.summaryGoodWithOptimizations' : 'resources.rec.summaryBadWithOptimizations'
    summaryParams.optCount = recommendations.length
  } else {
    summaryKey = 'resources.rec.summaryAllClear'
  }

  return { summary: '', summaryKey, summaryParams, recommendations }
}
