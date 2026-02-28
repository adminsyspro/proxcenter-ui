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

// Bilingual prompt strings
const promptStrings = {
  en: {
    intro: 'You are the AI assistant of ProxCenter, a Proxmox infrastructure management platform.',
    noActions: 'IMPORTANT: You CANNOT execute actions. You can only analyze and suggest. If the user asks for an action, explain what needs to be done but specify they must do it manually via the ProxCenter or Proxmox interface.',
    stateHeader: '=== CURRENT INFRASTRUCTURE STATE (live data) ===',
    summary: 'Global summary',
    totalVMs: (t: number, r: number, s: number) => `${t} VMs/CTs total (${r} running, ${s} stopped)`,
    hosts: (t: number, o: number) => `${t} host(s) (${o} online)`,
    clusters: (n: number, names: string) => `${n} cluster(s) configured: ${names || 'none'}`,
    hostsHeader: 'Proxmox hosts status',
    online: 'Online', offline: 'Offline',
    on: 'on',
    topCpu: 'Top 10 VMs/CTs by CPU usage',
    topRam: 'Top 10 VMs/CTs by RAM usage',
    stoppedHeader: (n: number) => `STOPPED VMs/CTs - FULL LIST (${n} total)`,
    stoppedCluster: (name: string, n: number) => `[${name}] (${n} stopped)`,
    alertsActive: (n: number) => `Active alerts (${n})`,
    noAlerts: 'No active alerts.',
    runningHeader: (total: number, shown: boolean) => `Running VMs/CTs (${total} total${shown ? ', first 20 shown' : ''})`,
    andMore: (n: number) => `... and ${n} more running VMs/CTs`,
    instructions: '=== INSTRUCTIONS ===',
    respondLang: 'Respond in English concisely',
    useData: 'Use ONLY the data above',
    citeNames: 'Cite exact VM names and metrics',
    explainActions: 'For actions, explain the procedure but specify you cannot execute it',
  },
  fr: {
    intro: 'Tu es l\'assistant IA de ProxCenter, une plateforme de gestion d\'infrastructure Proxmox.',
    noActions: 'IMPORTANT: Tu ne peux PAS exécuter d\'actions. Tu peux uniquement analyser et suggérer. Si l\'utilisateur demande une action, explique ce qu\'il faudrait faire mais précise qu\'il doit le faire manuellement via l\'interface ProxCenter ou Proxmox.',
    stateHeader: '=== ÉTAT ACTUEL DE L\'INFRASTRUCTURE (données en temps réel) ===',
    summary: 'Résumé global',
    totalVMs: (t: number, r: number, s: number) => `${t} VMs/CTs au total (${r} en cours d'exécution, ${s} arrêtées)`,
    hosts: (t: number, o: number) => `${t} hôte(s) (${o} en ligne)`,
    clusters: (n: number, names: string) => `${n} cluster(s) configuré(s): ${names || 'aucun'}`,
    hostsHeader: 'État des hôtes Proxmox',
    online: 'En ligne', offline: 'Hors ligne',
    on: 'sur',
    topCpu: 'Top 10 VMs/CTs par utilisation CPU',
    topRam: 'Top 10 VMs/CTs par utilisation RAM',
    stoppedHeader: (n: number) => `VMs/CTs ARRÊTÉES - LISTE COMPLÈTE (${n} total)`,
    stoppedCluster: (name: string, n: number) => `[${name}] (${n} arrêtées)`,
    alertsActive: (n: number) => `Alertes actives (${n})`,
    noAlerts: 'Aucune alerte active.',
    runningHeader: (total: number, shown: boolean) => `VMs/CTs en cours d'exécution (${total} total${shown ? ', 20 premières affichées' : ''})`,
    andMore: (n: number) => `... et ${n} autres VMs/CTs en cours d'exécution`,
    instructions: '=== INSTRUCTIONS ===',
    respondLang: 'Réponds en français de manière concise',
    useData: 'Utilise UNIQUEMENT les données ci-dessus',
    citeNames: 'Cite les noms exacts des VMs et métriques',
    explainActions: 'Pour les actions, explique la procédure mais précise que tu ne peux pas l\'exécuter',
  }
}

async function buildSystemPrompt(lang: string = 'en') {
  const s = lang === 'fr' ? promptStrings.fr : promptStrings.en
  const connections = await getConnections()
  const alerts = await getActiveAlerts()
  const infraData = await fetchProxmoxData(connections)

  const topCpuVMs = [...infraData.vms]
    .filter((vm: any) => vm.status === 'running')
    .sort((a: any, b: any) => parseFloat(b.cpu) - parseFloat(a.cpu))
    .slice(0, 10)

  const topMemVMs = [...infraData.vms]
    .filter((vm: any) => vm.status === 'running')
    .sort((a: any, b: any) => parseFloat(b.mem) - parseFloat(a.mem))
    .slice(0, 10)

  const stoppedVMs = infraData.vms.filter((vm: any) => vm.status !== 'running')
  const runningVMs = infraData.vms.filter((vm: any) => vm.status === 'running')

  let prompt = `${s.intro}

${s.noActions}

${s.stateHeader}

📊 ${s.summary}:
- ${s.totalVMs(infraData.summary.totalVMs, infraData.summary.runningVMs, infraData.summary.stoppedVMs)}
- ${s.hosts(infraData.summary.totalNodes, infraData.summary.onlineNodes)}
- ${s.clusters(infraData.clusters.length, infraData.clusters.map((c: any) => c.name).join(', '))}
`

  if (infraData.nodes.length > 0) {
    prompt += `
🖥️ ${s.hostsHeader}:
${infraData.nodes.map((n: any) => `- ${n.name} (${n.cluster}): ${n.status === 'online' ? `✅ ${s.online}` : `❌ ${s.offline}`} | CPU: ${n.cpu}% | RAM: ${n.mem}% (${n.memUsed}/${n.memTotal} GB)`).join('\n')}
`
  }

  if (topCpuVMs.length > 0) {
    prompt += `
🔥 ${s.topCpu}:
${topCpuVMs.map((vm: any, i: number) => `${i + 1}. ${vm.name} (${vm.type} ${vm.vmid}) ${s.on} ${vm.node} - CPU: ${vm.cpu}% | RAM: ${vm.mem}%`).join('\n')}
`
  }

  if (topMemVMs.length > 0) {
    prompt += `
💾 ${s.topRam}:
${topMemVMs.map((vm: any, i: number) => `${i + 1}. ${vm.name} (${vm.type} ${vm.vmid}) ${s.on} ${vm.node} - RAM: ${vm.mem}% (${vm.memUsed}/${vm.memTotal} GB)`).join('\n')}
`
  }

  let stoppedVMsSection = ''
  if (stoppedVMs.length > 0) {
    const byCluster: Record<string, any[]> = {}
    stoppedVMs.forEach((vm: any) => {
      if (!byCluster[vm.cluster]) byCluster[vm.cluster] = []
      byCluster[vm.cluster].push(vm)
    })
    stoppedVMsSection = `
⏹️ ${s.stoppedHeader(stoppedVMs.length)}:
${Object.entries(byCluster).map(([cluster, vms]) => {
  return `
${s.stoppedCluster(cluster, vms.length)}:
${vms.map((vm: any) => `  - ${vm.name} (${vm.type} ${vm.vmid}) ${s.on} ${vm.node}`).join('\n')}`
}).join('\n')}
`
  }

  if (alerts.length > 0) {
    prompt += `
⚠️ ${s.alertsActive(alerts.length)}:
${alerts.map((a: any) => `- [${a.severity?.toUpperCase()}] ${a.message} (${a.entityName || a.entityType})`).join('\n')}
`
  } else {
    prompt += `
✅ ${s.noAlerts}
`
  }

  if (runningVMs.length > 0) {
    const vmsToShow = runningVMs.slice(0, 20)
    prompt += `
📋 ${s.runningHeader(runningVMs.length, runningVMs.length > 20)}:
${vmsToShow.map((vm: any) => `- ${vm.name} (${vm.type} ${vm.vmid}) ${s.on} ${vm.node} - CPU: ${vm.cpu}% | RAM: ${vm.mem}%`).join('\n')}
${runningVMs.length > 20 ? `\n${s.andMore(runningVMs.length - 20)}` : ''}
`
  }

  prompt += stoppedVMsSection

  prompt += `
${s.instructions}
- ${s.respondLang}
- ${s.useData}
- ${s.citeNames}
- ${s.explainActions}
`

  return prompt
}

// POST /api/v1/ai/chat - Envoyer un message au LLM
export async function POST(request: Request) {
  try {
    const { messages, locale } = await request.json()
    const lang = locale === 'fr' ? 'fr' : 'en'
    const settings = getAISettings()

    if (!settings.enabled) {
      return NextResponse.json({
        error: lang === 'fr'
          ? 'L\'assistant IA n\'est pas activé. Allez dans Paramètres → Intelligence Artificielle pour le configurer.'
          : 'The AI assistant is not enabled. Go to Settings → Artificial Intelligence to configure it.'
      }, { status: 400 })
    }

    const systemPrompt = await buildSystemPrompt(lang)

    const lastUserMessage = messages[messages.length - 1]
    const userInstruction = lang === 'fr'
      ? 'Réponds en utilisant UNIQUEMENT les données de l\'infrastructure ci-dessus. Cite les noms exacts des VMs et leurs métriques.'
      : 'Respond using ONLY the infrastructure data above. Cite exact VM names and their metrics.'

    const contextualizedMessage = `${systemPrompt}

=== ${lang === 'fr' ? 'QUESTION DE L\'UTILISATEUR' : 'USER QUESTION'} ===
${lastUserMessage.content}

${userInstruction}`

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
      
      const openaiBase = (settings.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
      const response = await fetch(`${openaiBase}/chat/completions`, {
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
