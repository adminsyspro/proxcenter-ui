import { NextResponse } from "next/server"

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
}

// Appeler Ollama pour l'analyse
async function callOllama(prompt: string): Promise<string> {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434'
  const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.1:8b'
  
  console.log(`[resources/analyze] Calling Ollama at ${ollamaUrl} with model ${ollamaModel}`)
  
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
    console.log('[resources/analyze] /api/chat failed, trying /api/generate')
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  
return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function buildPrompt(kpis: KpiData, topCpuVms: TopVm[], topRamVms: TopVm[]): string {
  return `Tu es un expert en optimisation d'infrastructure Proxmox. Analyse les données suivantes et fournis des recommandations.

## Données de l'infrastructure

### KPIs globaux
- CPU: ${kpis.cpu.used.toFixed(1)}% utilisé (${kpis.cpu.allocated} vCPUs alloués sur ${kpis.cpu.total} disponibles)
- RAM: ${kpis.ram.used.toFixed(1)}% utilisée (${formatBytes(kpis.ram.allocated)} alloués sur ${formatBytes(kpis.ram.total)} disponibles)
- Stockage: ${((kpis.storage.used / kpis.storage.total) * 100).toFixed(1)}% utilisé (${formatBytes(kpis.storage.used)} sur ${formatBytes(kpis.storage.total)})
- VMs: ${kpis.vms.total} total (${kpis.vms.running} running, ${kpis.vms.stopped} stopped)
- Score d'efficacité: ${kpis.efficiency}%

### Tendances
- CPU: ${kpis.cpu.trend >= 0 ? '+' : ''}${kpis.cpu.trend}% sur 7 jours
- RAM: ${kpis.ram.trend >= 0 ? '+' : ''}${kpis.ram.trend}% sur 7 jours
- Stockage: ${kpis.storage.trend >= 0 ? '+' : ''}${kpis.storage.trend}% sur 7 jours

### Top 5 VMs consommatrices CPU
${topCpuVms.slice(0, 5).map((vm, i) => `${i + 1}. ${vm.name} (${vm.node}): ${vm.cpu}% CPU, ${vm.cpuAllocated} vCPUs`).join('\n')}

### Top 5 VMs consommatrices RAM
${topRamVms.slice(0, 5).map((vm, i) => `${i + 1}. ${vm.name} (${vm.node}): ${vm.ram}% RAM, ${formatBytes(vm.ramAllocated)}`).join('\n')}

## Instructions

Réponds UNIQUEMENT avec un JSON valide (sans markdown, sans backticks, sans texte avant ou après) avec cette structure:
{
  "summary": "Un résumé de 2-3 phrases de l'état de l'infrastructure",
  "recommendations": [
    {
      "id": "rec_1",
      "type": "overprovisioned|underused|stopped|prediction|optimization",
      "severity": "high|medium|low|info",
      "title": "Titre court",
      "description": "Description détaillée",
      "savings": "Économie potentielle (optionnel)",
      "vmName": "Nom de la VM concernée (optionnel)"
    }
  ]
}

Génère entre 3 et 6 recommandations pertinentes basées sur les données.`
}

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const { kpis, topCpuVms, topRamVms } = body as {
      kpis: KpiData
      topCpuVms: TopVm[]
      topRamVms: TopVm[]
    }

    if (!kpis) {
      return NextResponse.json({ error: "Missing KPI data" }, { status: 400 })
    }

    // Construire le prompt
    const prompt = buildPrompt(kpis, topCpuVms || [], topRamVms || [])
    
    // Essayer Ollama, sinon fallback basique
    const ollamaAvailable = await isOllamaAvailable()
    
    let responseText = ''
    let provider = 'basic'
    
    if (ollamaAvailable) {
      // Utiliser Ollama
      try {
        responseText = await callOllama(prompt)
        provider = 'ollama'
        console.log('[resources/analyze] Using Ollama')
      } catch (e) {
        console.error('[resources/analyze] Ollama error:', e)
      }
    }
    
    if (!responseText) {
      // Fallback sur recommandations basiques
      console.log('[resources/analyze] Using basic recommendations')
      
return NextResponse.json({
        data: {
          ...generateBasicRecommendations(kpis, topCpuVms || [], topRamVms || []),
          provider: 'basic'
        }
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
      
return NextResponse.json({
        data: {
          ...generateBasicRecommendations(kpis, topCpuVms || [], topRamVms || []),
          provider: 'basic'
        }
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
function generateBasicRecommendations(
  kpis: KpiData, 
  topCpuVms: TopVm[], 
  topRamVms: TopVm[]
): { summary: string; recommendations: Recommendation[] } {
  const recommendations: Recommendation[] = []
  
  // Analyse CPU
  if (kpis.cpu.used > 80) {
    recommendations.push({
      id: 'rec_cpu_high',
      type: 'prediction',
      severity: 'high',
      title: 'Utilisation CPU élevée',
      description: `L'utilisation CPU globale est à ${kpis.cpu.used.toFixed(1)}%. Envisagez d'ajouter des ressources ou de migrer des VMs.`
    })
  } else if (kpis.cpu.used < 20 && kpis.cpu.allocated > kpis.cpu.total * 0.5) {
    recommendations.push({
      id: 'rec_cpu_over',
      type: 'overprovisioned',
      severity: 'medium',
      title: 'CPU surprovisionné',
      description: `Seulement ${kpis.cpu.used.toFixed(1)}% de CPU utilisé malgré ${kpis.cpu.allocated} vCPUs alloués. Des VMs pourraient être redimensionnées.`,
      savings: 'Réduction possible des vCPUs'
    })
  }
  
  // Analyse RAM
  if (kpis.ram.used > 85) {
    recommendations.push({
      id: 'rec_ram_high',
      type: 'prediction',
      severity: 'high',
      title: 'Mémoire presque saturée',
      description: `L'utilisation RAM est à ${kpis.ram.used.toFixed(1)}%. Risque de saturation imminente.`
    })
  }
  
  // Analyse stockage
  if ((kpis.storage.used / kpis.storage.total) > 0.8) {
    recommendations.push({
      id: 'rec_storage_high',
      type: 'prediction',
      severity: 'high',
      title: 'Stockage critique',
      description: `Le stockage est utilisé à ${((kpis.storage.used / kpis.storage.total) * 100).toFixed(1)}%. Libérez de l'espace ou ajoutez du stockage.`
    })
  }
  
  // VMs arrêtées
  if (kpis.vms.stopped > 5) {
    recommendations.push({
      id: 'rec_vms_stopped',
      type: 'stopped',
      severity: 'low',
      title: `${kpis.vms.stopped} VMs arrêtées`,
      description: 'Vérifiez si ces VMs sont encore nécessaires. Les supprimer libérerait du stockage.',
      savings: 'Stockage récupérable'
    })
  }
  
  // Top VM CPU sous-utilisée
  const underusedCpu = topCpuVms.find(vm => vm.cpu < 10 && vm.cpuAllocated >= 4)

  if (underusedCpu) {
    recommendations.push({
      id: 'rec_vm_cpu_underused',
      type: 'underused',
      severity: 'medium',
      title: 'VM CPU sous-utilisée',
      description: `${underusedCpu.name} utilise seulement ${underusedCpu.cpu}% CPU avec ${underusedCpu.cpuAllocated} vCPUs alloués.`,
      vmName: underusedCpu.name,
      savings: `${Math.floor(underusedCpu.cpuAllocated / 2)} vCPUs récupérables`
    })
  }
  
  // Score d'efficacité
  if (kpis.efficiency < 50) {
    recommendations.push({
      id: 'rec_efficiency',
      type: 'optimization',
      severity: 'medium',
      title: 'Score d\'efficacité faible',
      description: `Le score d'efficacité de ${kpis.efficiency}% indique un déséquilibre entre ressources allouées et utilisées.`
    })
  }
  
  // Générer le résumé
  let summary = `Infrastructure avec ${kpis.vms.total} VMs dont ${kpis.vms.running} en fonctionnement. `
  
  if (kpis.efficiency >= 70) {
    summary += `Bonne efficacité globale (${kpis.efficiency}%). `
  } else {
    summary += `Efficacité à améliorer (${kpis.efficiency}%). `
  }
  
  if (recommendations.filter(r => r.severity === 'high').length > 0) {
    summary += `${recommendations.filter(r => r.severity === 'high').length} point(s) critiques nécessitent votre attention.`
  } else if (recommendations.length > 0) {
    summary += `${recommendations.length} optimisations possibles identifiées.`
  } else {
    summary += `Aucun problème majeur détecté.`
  }
  
  return { summary, recommendations }
}
