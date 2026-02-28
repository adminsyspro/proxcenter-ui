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
      const token = decryptSecret(conn.apiTokenEnc)
      
      const resources = await pveFetch<any[]>(
        {
          baseUrl: conn.baseUrl,
          apiToken: token,
          insecureDev: conn.insecureTLS
        },
        '/cluster/resources'
      )
      
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

// Construire le prompt système
async function buildSystemPrompt(lang: string = 'en') {
  const isFr = lang === 'fr'
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

  let prompt = isFr
    ? `Tu es l'assistant IA de ProxCenter, une plateforme de gestion d'infrastructure Proxmox.\n\nIMPORTANT: Tu ne peux PAS exécuter d'actions. Tu peux uniquement analyser et suggérer.`
    : `You are the AI assistant of ProxCenter, a Proxmox infrastructure management platform.\n\nIMPORTANT: You CANNOT execute actions. You can only analyze and suggest.`

  prompt += `\n\n=== ${isFr ? 'ÉTAT ACTUEL DE L\'INFRASTRUCTURE' : 'CURRENT INFRASTRUCTURE STATE'} ===\n`
  prompt += `\n📊 ${isFr ? 'Résumé' : 'Summary'}:\n`
  prompt += `- ${infraData.summary.totalVMs} VMs/CTs (${infraData.summary.runningVMs} running, ${infraData.summary.stoppedVMs} stopped)\n`
  prompt += `- ${infraData.summary.totalNodes} ${isFr ? 'hôtes' : 'hosts'} (${infraData.summary.onlineNodes} online)\n`
  prompt += `- ${infraData.clusters.length} cluster(s)\n`

  if (infraData.nodes.length > 0) {
    prompt += `\n🖥️ ${isFr ? 'Hôtes' : 'Hosts'}:\n`
    prompt += infraData.nodes.map((n: any) => `- ${n.name}: ${n.status} | CPU: ${n.cpu}% | RAM: ${n.mem}%`).join('\n') + '\n'
  }

  if (topCpuVMs.length > 0) {
    prompt += `\n🔥 Top 10 CPU:\n`
    prompt += topCpuVMs.map((vm: any, i: number) => `${i + 1}. ${vm.name} (${vm.vmid}) - ${vm.cpu}%`).join('\n') + '\n'
  }

  if (topMemVMs.length > 0) {
    prompt += `\n💾 Top 10 RAM:\n`
    prompt += topMemVMs.map((vm: any, i: number) => `${i + 1}. ${vm.name} (${vm.vmid}) - ${vm.mem}%`).join('\n') + '\n'
  }

  if (alerts.length > 0) {
    prompt += `\n⚠️ ${isFr ? 'Alertes' : 'Alerts'} (${alerts.length}):\n`
    prompt += alerts.map((a: any) => `- [${a.severity}] ${a.message}`).join('\n') + '\n'
  }

  if (runningVMs.length > 0) {
    const vmsToShow = runningVMs.slice(0, 20)
    prompt += `\n📋 VMs running (${runningVMs.length}):\n`
    prompt += vmsToShow.map((vm: any) => `- ${vm.name} (${vm.vmid}) ${isFr ? 'sur' : 'on'} ${vm.node}`).join('\n') + '\n'
  }

  if (stoppedVMs.length > 0) {
    const byCluster: Record<string, any[]> = {}
    stoppedVMs.forEach((vm: any) => {
      if (!byCluster[vm.cluster]) byCluster[vm.cluster] = []
      byCluster[vm.cluster].push(vm)
    })
    prompt += `\n⏹️ ${isFr ? 'VMs ARRÊTÉES' : 'STOPPED VMs'} (${stoppedVMs.length} total):\n`
    prompt += Object.entries(byCluster).map(([cluster, vms]) => {
      return `[${cluster}] (${vms.length}):\n${vms.map((vm: any) => `  - ${vm.name} (${vm.vmid}) ${isFr ? 'sur' : 'on'} ${vm.node}`).join('\n')}`
    }).join('\n') + '\n'
  }

  prompt += `\n=== INSTRUCTIONS ===\n`
  prompt += isFr
    ? `- Réponds en français\n- Utilise les données ci-dessus\n- Cite les noms exacts\n`
    : `- Respond in English\n- Use the data above\n- Cite exact names\n`

  return prompt
}

// POST /api/v1/ai/chat/stream - Chat avec streaming
export async function POST(request: Request) {
  try {
    const { messages, locale } = await request.json()
    const lang = locale === 'fr' ? 'fr' : 'en'
    const settings = getAISettings()

    if (!settings.enabled) {
      return NextResponse.json({
        error: lang === 'fr'
          ? 'L\'assistant IA n\'est pas activé.'
          : 'The AI assistant is not enabled.'
      }, { status: 400 })
    }

    const systemPrompt = await buildSystemPrompt(lang)

    const lastUserMessage = messages[messages.length - 1]
    const contextualizedMessage = `${systemPrompt}

=== ${lang === 'fr' ? 'QUESTION' : 'QUESTION'} ===
${lastUserMessage.content}

${lang === 'fr' ? 'Réponds en utilisant UNIQUEMENT les données ci-dessus.' : 'Respond using ONLY the data above.'}`

    if (settings.provider === 'ollama') {
      const ollamaMessages = [
        ...messages.slice(0, -1),
        { role: 'user', content: contextualizedMessage }
      ]
      
      // Appel Ollama avec streaming
      const response = await fetch(`${settings.ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.ollamaModel,
          messages: ollamaMessages,
          stream: true,
          options: {
            num_predict: 4096,
            temperature: 0.3
          }
        })
      })
      
      if (!response.ok) {
        const text = await response.text()

        throw new Error(`Ollama error: ${text}`)
      }
      
      // Créer un ReadableStream pour le streaming
      const encoder = new TextEncoder()

      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body?.getReader()

          if (!reader) {
            controller.close()
            
return
          }
          
          const decoder = new TextDecoder()
          
          try {
            while (true) {
              const { done, value } = await reader.read()

              if (done) break
              
              const chunk = decoder.decode(value, { stream: true })
              const lines = chunk.split('\n').filter(line => line.trim())
              
              for (const line of lines) {
                try {
                  const json = JSON.parse(line)

                  if (json.message?.content) {
                    controller.enqueue(encoder.encode(json.message.content))
                  }
                } catch {
                  // Ignorer les lignes non-JSON
                }
              }
            }
          } catch (e) {
            console.error('Stream error:', e)
          } finally {
            controller.close()
          }
        }
      })
      
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Transfer-Encoding': 'chunked'
        }
      })
      
    } else {
      // Pour OpenAI et Anthropic, on pourrait aussi implémenter le streaming
      // mais pour l'instant on retourne une erreur
      return NextResponse.json({ 
        error: lang === 'fr'
          ? 'Le streaming n\'est supporté que pour Ollama.'
          : 'Streaming is only supported for Ollama.'
      }, { status: 400 })
    }
    
  } catch (e: any) {
    console.error('AI chat stream failed:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
