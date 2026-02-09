import { NextResponse } from 'next/server'

import { getDb } from '@/lib/db/sqlite'
import { prisma } from '@/lib/db/prisma'
import { pveFetch } from '@/lib/proxmox/client'
import { decryptSecret } from '@/lib/crypto/secret'

// Récupérer les paramètres IA
function getAISettings() {
  try {
    const db = getDb()
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?')
    const row = stmt.get('ai') as { value: string } | undefined
    
    if (row?.value) {
      return JSON.parse(row.value)
    }
  } catch (e) {
    console.error('Failed to get AI settings:', e)
  }
  
  return {
    enabled: false,
    provider: 'ollama',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'mistral:7b'
  }
}

// Récupérer les connexions PVE via Prisma
async function getConnections() {
  try {
    const connections = await prisma.connection.findMany({
      where: { type: 'pve' },
      select: {
        id: true,
        name: true,
        type: true,
        baseUrl: true,
        apiTokenEnc: true,
        insecureTLS: true,
      }
    })

    return connections
  } catch (e) {
    console.error('Failed to get connections:', e)
    
return []
  }
}

// Récupérer les alertes actives via Prisma
async function getActiveAlerts() {
  try {
    const alerts = await prisma.alert.findMany({
      where: { status: 'active' },
      orderBy: { lastSeenAt: 'desc' },
      take: 10,
      select: {
        severity: true,
        message: true,
        entityName: true,
        entityType: true,
        metric: true,
        currentValue: true,
        threshold: true,
      }
    })

    
return alerts
  } catch (e) {
    console.error('Failed to get alerts:', e)
    
return []
  }
}

// Récupérer les données live de Proxmox
async function fetchProxmoxData(connections: any[]) {
  const allData: any = {
    clusters: [],
    nodes: [],
    vms: [],
    summary: {
      totalVMs: 0,
      runningVMs: 0,
      stoppedVMs: 0,
      totalNodes: 0,
      onlineNodes: 0
    }
  }

  for (const conn of connections) {
    try {
      // Décrypter le token avec la fonction du projet
      const token = decryptSecret(conn.apiTokenEnc)

      // Utiliser pveFetch pour les requêtes Proxmox (gère HTTPS et certificats auto-signés)
      const resources = await pveFetch<any[]>(
        {
          baseUrl: conn.baseUrl,
          apiToken: token,
          insecureDev: conn.insecureTLS
        },
        '/cluster/resources'
      )
      
      // Process nodes
      const nodes = resources.filter((r: any) => r.type === 'node')

      nodes.forEach((n: any) => {
        allData.nodes.push({
          name: n.node,
          status: n.status,
          cpu: n.cpu ? (n.cpu * 100).toFixed(1) : 0,
          mem: n.mem && n.maxmem ? ((n.mem / n.maxmem) * 100).toFixed(1) : 0,
          memUsed: n.mem ? (n.mem / 1024 / 1024 / 1024).toFixed(1) : 0,
          memTotal: n.maxmem ? (n.maxmem / 1024 / 1024 / 1024).toFixed(1) : 0,
          cluster: conn.name
        })
        allData.summary.totalNodes++
        if (n.status === 'online') allData.summary.onlineNodes++
      })
      
      // Process VMs (qemu) and Containers (lxc)
      const vms = resources.filter((r: any) => r.type === 'qemu' || r.type === 'lxc')

      vms.forEach((vm: any) => {
        allData.vms.push({
          vmid: vm.vmid,
          name: vm.name || `VM ${vm.vmid}`,
          type: vm.type === 'lxc' ? 'CT' : 'VM',
          status: vm.status,
          cpu: vm.cpu ? (vm.cpu * 100).toFixed(1) : 0,
          mem: vm.mem && vm.maxmem ? ((vm.mem / vm.maxmem) * 100).toFixed(1) : 0,
          memUsed: vm.mem ? (vm.mem / 1024 / 1024 / 1024).toFixed(2) : 0,
          memTotal: vm.maxmem ? (vm.maxmem / 1024 / 1024 / 1024).toFixed(2) : 0,
          node: vm.node,
          cluster: conn.name
        })
        allData.summary.totalVMs++
        if (vm.status === 'running') allData.summary.runningVMs++
        else allData.summary.stoppedVMs++
      })
      
      allData.clusters.push({
        name: conn.name,
        nodes: nodes.length,
        vms: vms.length
      })
    } catch (e) {
      console.error(`Failed to fetch data from ${conn.name}:`, e)
    }
  }
  
  return allData
}

// Construire le prompt système avec le contexte réel
async function buildSystemPrompt() {
  const connections = await getConnections()

  const alerts = await getActiveAlerts()
  const infraData = await fetchProxmoxData(connections)
  
  // Trier les VMs par CPU pour trouver les plus gourmandes
  const topCpuVMs = [...infraData.vms]
    .filter((vm: any) => vm.status === 'running')
    .sort((a: any, b: any) => parseFloat(b.cpu) - parseFloat(a.cpu))
    .slice(0, 10) // Top 10 CPU
  
  // Trier les VMs par RAM
  const topMemVMs = [...infraData.vms]
    .filter((vm: any) => vm.status === 'running')
    .sort((a: any, b: any) => parseFloat(b.mem) - parseFloat(a.mem))
    .slice(0, 10) // Top 10 RAM

  // VMs arrêtées (toutes)
  const stoppedVMs = infraData.vms.filter((vm: any) => vm.status !== 'running')
  
  // VMs en cours d'exécution
  const runningVMs = infraData.vms.filter((vm: any) => vm.status === 'running')
  
  let prompt = `Tu es l'assistant IA de ProxCenter, une plateforme de gestion d'infrastructure Proxmox.

IMPORTANT: Tu ne peux PAS exécuter d'actions. Tu peux uniquement analyser et suggérer. Si l'utilisateur demande une action, explique ce qu'il faudrait faire mais précise qu'il doit le faire manuellement via l'interface ProxCenter ou Proxmox.

=== ÉTAT ACTUEL DE L'INFRASTRUCTURE (données en temps réel) ===

📊 Résumé global:
- ${infraData.summary.totalVMs} VMs/CTs au total (${infraData.summary.runningVMs} en cours d'exécution, ${infraData.summary.stoppedVMs} arrêtées)
- ${infraData.summary.totalNodes} hôte(s) (${infraData.summary.onlineNodes} en ligne)
- ${infraData.clusters.length} cluster(s) configuré(s): ${infraData.clusters.map((c: any) => c.name).join(', ') || 'aucun'}
`

  if (infraData.nodes.length > 0) {
    prompt += `
🖥️ État des hôtes Proxmox:
${infraData.nodes.map((n: any) => `- ${n.name} (${n.cluster}): ${n.status === 'online' ? '✅ En ligne' : '❌ Hors ligne'} | CPU: ${n.cpu}% | RAM: ${n.mem}% (${n.memUsed}/${n.memTotal} GB)`).join('\n')}
`
  }

  if (topCpuVMs.length > 0) {
    prompt += `
🔥 Top 10 VMs/CTs par utilisation CPU:
${topCpuVMs.map((vm: any, i: number) => `${i + 1}. ${vm.name} (${vm.type} ${vm.vmid}) sur ${vm.node} - CPU: ${vm.cpu}% | RAM: ${vm.mem}%`).join('\n')}
`
  }

  if (topMemVMs.length > 0) {
    prompt += `
💾 Top 10 VMs/CTs par utilisation RAM:
${topMemVMs.map((vm: any, i: number) => `${i + 1}. ${vm.name} (${vm.type} ${vm.vmid}) sur ${vm.node} - RAM: ${vm.mem}% (${vm.memUsed}/${vm.memTotal} GB)`).join('\n')}
`
  }

  // Liste COMPLÈTE des VMs arrêtées - groupées par cluster pour réduire la taille
  let stoppedVMsSection = ''

  if (stoppedVMs.length > 0) {
    // Grouper par cluster
    const byCluster: Record<string, any[]> = {}

    stoppedVMs.forEach((vm: any) => {
      if (!byCluster[vm.cluster]) byCluster[vm.cluster] = []
      byCluster[vm.cluster].push(vm)
    })
    
    stoppedVMsSection = `
⏹️ VMs/CTs ARRÊTÉES - LISTE COMPLÈTE (${stoppedVMs.length} total):
${Object.entries(byCluster).map(([cluster, vms]) => {
  return `
[${cluster}] (${vms.length} arrêtées):
${vms.map((vm: any) => `  - ${vm.name} (${vm.type} ${vm.vmid}) sur ${vm.node}`).join('\n')}`
}).join('\n')}
`
  }

  if (alerts.length > 0) {
    prompt += `
⚠️ Alertes actives (${alerts.length}):
${alerts.map((a: any) => `- [${a.severity?.toUpperCase()}] ${a.message} (${a.entityName || a.entityType})`).join('\n')}
`
  } else {
    prompt += `
✅ Aucune alerte active.
`
  }

  // Liste des VMs en cours d'exécution (limité pour le contexte)
  if (runningVMs.length > 0) {
    const vmsToShow = runningVMs.slice(0, 20) // Réduit à 20

    prompt += `
📋 VMs/CTs en cours d'exécution (${runningVMs.length} total${runningVMs.length > 20 ? ', 20 premières affichées' : ''}):
${vmsToShow.map((vm: any) => `- ${vm.name} (${vm.type} ${vm.vmid}) sur ${vm.node} - CPU: ${vm.cpu}% | RAM: ${vm.mem}%`).join('\n')}
${runningVMs.length > 20 ? `\n... et ${runningVMs.length - 20} autres VMs/CTs en cours d'exécution` : ''}
`
  }

  // IMPORTANT: VMs arrêtées à la FIN pour que Mistral les voie bien
  prompt += stoppedVMsSection

  prompt += `
=== INSTRUCTIONS ===
- Réponds en français de manière concise
- Utilise UNIQUEMENT les données ci-dessus
- Cite les noms exacts des VMs et métriques
- Pour les actions, explique la procédure mais précise que tu ne peux pas l'exécuter
`

  return prompt
}

// POST /api/v1/ai/chat - Envoyer un message au LLM
export async function POST(request: Request) {
  try {
    const { messages } = await request.json()
    const settings = getAISettings()
    
    if (!settings.enabled) {
      return NextResponse.json({ 
        error: 'L\'assistant IA n\'est pas activé. Allez dans Paramètres → Intelligence Artificielle pour le configurer.' 
      }, { status: 400 })
    }
    
    const systemPrompt = await buildSystemPrompt()
    
    // Pour Ollama, on injecte le contexte dans le premier message utilisateur
    // car certains modèles ignorent le system prompt
    const lastUserMessage = messages[messages.length - 1]

    const contextualizedMessage = `${systemPrompt}

=== QUESTION DE L'UTILISATEUR ===
${lastUserMessage.content}

Réponds en utilisant UNIQUEMENT les données de l'infrastructure ci-dessus. Cite les noms exacts des VMs et leurs métriques.`

    if (settings.provider === 'ollama') {
      // Ollama API - contexte injecté dans le message
      const ollamaMessages = [
        ...messages.slice(0, -1), // Messages précédents sans le dernier
        { role: 'user', content: contextualizedMessage }
      ]
      
      const response = await fetch(`${settings.ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.ollamaModel,
          messages: ollamaMessages,
          stream: false,
          options: {
            num_predict: 4096, // Permet des réponses plus longues
            temperature: 0.3  // Plus déterministe pour les listes
          }
        })
      })
      
      if (!response.ok) {
        const text = await response.text()

        throw new Error(`Ollama error: ${text}`)
      }
      
      const json = await response.json()

      
return NextResponse.json({ 
        response: json.message?.content || json.response,
        provider: 'ollama',
        model: settings.ollamaModel
      })
      
    } else if (settings.provider === 'openai') {
      // OpenAI API
      const openaiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages
      ]
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.openaiKey}`
        },
        body: JSON.stringify({
          model: settings.openaiModel,
          messages: openaiMessages,
          max_tokens: 1000
        })
      })
      
      if (!response.ok) {
        const json = await response.json().catch(() => ({}))

        throw new Error(json?.error?.message || `OpenAI error: ${response.status}`)
      }
      
      const json = await response.json()

      
return NextResponse.json({ 
        response: json.choices?.[0]?.message?.content,
        provider: 'openai',
        model: settings.openaiModel
      })
      
    } else if (settings.provider === 'anthropic') {
      // Anthropic API
      const anthropicMessages = messages.map((m: any) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }))
      
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-api-key': settings.anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: settings.anthropicModel,
          system: systemPrompt,
          messages: anthropicMessages,
          max_tokens: 1000
        })
      })
      
      if (!response.ok) {
        const json = await response.json().catch(() => ({}))

        throw new Error(json?.error?.message || `Anthropic error: ${response.status}`)
      }
      
      const json = await response.json()

      
return NextResponse.json({ 
        response: json.content?.[0]?.text,
        provider: 'anthropic',
        model: settings.anthropicModel
      })
      
    } else {
      throw new Error(`Provider inconnu: ${settings.provider}`)
    }
    
  } catch (e: any) {
    console.error('AI chat failed:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
