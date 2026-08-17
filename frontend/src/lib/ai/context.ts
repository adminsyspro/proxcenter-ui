/**
 * Shared infrastructure context for the AI assistant.
 *
 * Two things used to be wrong with how the assistant got its data, and both are
 * fixed here:
 *
 *  1. `ai/chat` and `ai/chat/stream` each carried their own copy of the
 *     gathering + prompt code, and the copies had already drifted apart. Any
 *     new data source had to be added twice.
 *
 *  2. Both copies read `prisma.connection.findMany({ type: 'pve' })` and then
 *     hit `/cluster/resources` directly. That is tenant-scoped (session
 *     Prisma) but it bypasses RBAC entirely: a user restricted to a pool, a
 *     tag or a set of nodes still got the whole tenant's guests in the prompt,
 *     and could simply ask the assistant to list them. The snapshot below goes
 *     through the same pipeline `/api/v1/inventory` uses (vDC mask, then RBAC
 *     infra scope, then per-guest `filterVmsByPermission`), so the assistant
 *     can never see more than the caller's own inventory tree.
 *
 * Reading the shared inventory cache instead of re-sweeping Proxmox also makes
 * the tool calls in `./tools` cheap: they answer from an already-warm snapshot
 * rather than fanning out to `pveproxy` per question.
 */

import { getCurrentTenantId, getSessionPrisma } from '@/lib/tenant'
import {
  getRBACContext,
  getRbacInfraScope,
  filterVmsByPermission,
  applyRbacInfraFilter,
  filterCandidateConnections,
  pruneEmptyConnections,
  PERMISSIONS,
} from '@/lib/rbac'
import { getTenantInfrastructureScope, maskingScope } from '@/lib/tenant/infraScope'
import { getVdcContext } from '@/lib/vdc/context'
import { applyVdcFilter } from '@/lib/vdc/scope'
import { getInventorySWR, type ClusterData } from '@/lib/inventory/fetchRawInventory'
import { languageInstruction, localeToLanguageName } from '@/lib/ai/locale'

const BYTES_PER_GB = 1024 * 1024 * 1024

/** How many stopped guests the prompt lists before deferring to a tool call. */
export const STOPPED_GUEST_PROMPT_CAP = 40

/** How many running guests the prompt lists. Unchanged from the original. */
export const RUNNING_GUEST_PROMPT_CAP = 20

export type AiGuest = {
  connId: string
  cluster: string
  vmid: string
  name: string
  /** `VM` for qemu, `CT` for lxc, the wording the prompt and answers use. */
  type: 'VM' | 'CT'
  /** Raw Proxmox kind, kept for tools that must build an API path. */
  kind: 'qemu' | 'lxc'
  status: string
  node: string
  cpuPct: number
  /** vCPUs assigned, absent when Proxmox did not report it. */
  vcpus?: number
  memPct: number
  memUsedGb: number
  memTotalGb: number
  /** Provisioned disk, from `maxdisk`. */
  diskTotalGb?: number
  /** Disk in use as Proxmox sees it; meaningless for most qemu guests. */
  diskUsedGb?: number
  pool?: string
  tags?: string
  template: boolean
}

export type AiNode = {
  connId: string
  cluster: string
  name: string
  status: string
  cpuPct: number
  cores?: number
  memPct: number
  memUsedGb: number
  memTotalGb: number
  maintenance?: string
}

export type AiCluster = {
  id: string
  name: string
  nodeCount: number
  guestCount: number
  cephHealth?: string
}

export type AiSnapshot = {
  clusters: AiCluster[]
  nodes: AiNode[]
  guests: AiGuest[]
  summary: {
    totalGuests: number
    runningGuests: number
    stoppedGuests: number
    totalNodes: number
    onlineNodes: number
  }
  /** Whether the snapshot came from cache, for logging only. */
  cached: boolean
}

export type AiAlert = {
  severity?: string | null
  message?: string | null
  entityName?: string | null
  entityType?: string | null
  metric?: string | null
  currentValue?: number | null
  threshold?: number | null
}

function pct(used?: number, total?: number): number {
  if (!used || !total || total <= 0) return 0

  return Number(((used / total) * 100).toFixed(1))
}

function gb(bytes?: number, digits = 1): number {
  if (!bytes || bytes <= 0) return 0

  return Number((bytes / BYTES_PER_GB).toFixed(digits))
}

/**
 * The caller's inventory tree, filtered exactly like `/api/v1/inventory`.
 *
 * Mirrors that route step for step on purpose: the two must not be allowed to
 * disagree about what a scoped user may see.
 */
export async function collectAiSnapshot(): Promise<AiSnapshot> {
  const tenantId = await getCurrentTenantId()

  // Resolve the principal before the scope: an API token must never depend on
  // a browser view-context cookie (shared cookie jar).
  const rbacCtx = await getRBACContext()
  const isTokenPrincipal = rbacCtx?.principal?.kind === 'token'
  const vdcContext = isTokenPrincipal ? null : await getVdcContext(tenantId)
  const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: isTokenPrincipal })
  const mask = maskingScope(infra)

  const { raw, cached } = await getInventorySWR(tenantId, infra, false, false, vdcContext)

  const rbacPrincipal = rbacCtx?.principal ?? (rbacCtx?.userId as string | undefined)
  const rbacScope = rbacCtx && !rbacCtx.isAdmin && rbacPrincipal
    ? await getRbacInfraScope(rbacPrincipal, rbacCtx.tenantId)
    : null

  let visibleRaw = mask ? raw.clusters.filter(c => mask.connectionIds.has(c.id)) : raw.clusters

  // Candidate set only: a guest-derived (tag/pool) scope cannot decide here,
  // the surviving guests below define the real perimeter (#633).
  visibleRaw = filterCandidateConnections(visibleRaw, rbacScope)

  let clusters: ClusterData[] = visibleRaw.map(c => ({
    ...c,
    nodes: c.nodes.map(n => ({ ...n, guests: [...n.guests] })),
  }))

  clusters = await Promise.all(clusters.map(async cluster => {
    let filtered = cluster

    if (rbacCtx && !rbacCtx.isAdmin) {
      const filteredNodes = await Promise.all(
        cluster.nodes.map(async node => ({
          ...node,
          guests: await filterVmsByPermission(
            rbacPrincipal as any,
            node.guests.map(g => ({
              ...g,
              connId: cluster.id,
              node: node.node,
              vmid: String(g.vmid),
            })),
            PERMISSIONS.VM_VIEW,
            rbacCtx.tenantId
          ),
        }))
      )

      filtered = { ...cluster, nodes: filteredNodes }
    }

    return applyRbacInfraFilter(applyVdcFilter(filtered, mask), rbacScope)
  }))

  clusters = pruneEmptyConnections(clusters, rbacScope)

  const aiClusters: AiCluster[] = []
  const nodes: AiNode[] = []
  const guests: AiGuest[] = []

  for (const cluster of clusters) {
    let guestCount = 0

    for (const node of cluster.nodes) {
      nodes.push({
        connId: cluster.id,
        cluster: cluster.name,
        name: node.node,
        status: node.status,
        cpuPct: node.cpu ? Number((node.cpu * 100).toFixed(1)) : 0,
        cores: node.maxcpu,
        memPct: pct(node.mem, node.maxmem),
        memUsedGb: gb(node.mem),
        memTotalGb: gb(node.maxmem),
        maintenance: node.maintenance,
      })

      for (const g of node.guests) {
        guestCount++
        guests.push({
          connId: cluster.id,
          cluster: cluster.name,
          vmid: String(g.vmid),
          name: g.name || `${g.type}/${g.vmid}`,
          type: g.type === 'lxc' ? 'CT' : 'VM',
          kind: g.type === 'lxc' ? 'lxc' : 'qemu',
          status: g.status,
          node: node.node,
          cpuPct: g.cpu ? Number((g.cpu * 100).toFixed(1)) : 0,
          vcpus: g.maxcpu,
          memPct: pct(g.mem, g.maxmem),
          memUsedGb: gb(g.mem, 2),
          memTotalGb: gb(g.maxmem, 2),
          diskTotalGb: g.maxdisk ? gb(g.maxdisk) : undefined,
          diskUsedGb: g.disk ? gb(g.disk) : undefined,
          pool: g.pool,
          tags: g.tags,
          template: g.template === true,
        })
      }
    }

    aiClusters.push({
      id: cluster.id,
      name: cluster.name,
      nodeCount: cluster.nodes.length,
      guestCount,
      cephHealth: cluster.cephHealth,
    })
  }

  const runningGuests = guests.filter(g => g.status === 'running').length
  const onlineNodes = nodes.filter(n => n.status === 'online').length

  return {
    clusters: aiClusters,
    nodes,
    guests,
    summary: {
      totalGuests: guests.length,
      runningGuests,
      stoppedGuests: guests.length - runningGuests,
      totalNodes: nodes.length,
      onlineNodes,
    },
    cached,
  }
}

export async function collectActiveAlerts(): Promise<AiAlert[]> {
  try {
    const prisma = await getSessionPrisma()

    return await prisma.alert.findMany({
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
      },
    })
  } catch (e) {
    console.error('[ai] Failed to get alerts:', e)

    return []
  }
}

/* ------------------------------------------------------------------ */
/* Prompt strings                                                     */
/* ------------------------------------------------------------------ */

export const promptStrings = {
  en: {
    intro: 'You are the AI assistant of ProxCenter, a Proxmox infrastructure management platform.',
    noActions: 'IMPORTANT: You CANNOT execute actions. You can only analyze and suggest. If the user asks for an action, explain what needs to be done but specify they must do it manually via the ProxCenter or Proxmox interface.',
    /*
     * Replaces `noActions` once tools are attached, and the framing is the whole
     * point. Three recette rounds on qwen2.5:7b against the lab cluster:
     *
     *  1. It narrated the call ("we could run the following:" + a JSON fence)
     *     and transcribed the entire payload.
     *  2. Told not to restate the result, it collapsed to "there are
     *     improvements to make" and named none.
     *  3. Told never to mention a tool call, it stopped CALLING tools: a 7B
     *     reads "never mention a tool call" as "do not make one", and the write
     *     ban plus "explain the procedure, you cannot execute it" compounded
     *     into a four-step manual procedure telling the user to run
     *     `ceph health detail` themselves.
     *
     * So: calling is stated as expected and routine, the ban is narrowed to the
     * *display* of a call, and deferring a lookup to the user is called out as a
     * failure. The write ban only ever concerns changing something.
     */
    toolsIntro: 'You have read-only tools that fetch infrastructure details absent from the snapshot below: VM hardware sizing, host hardware (network interfaces, physical disks), storage capacity, and Ceph health, OSDs and latency. CALLING A TOOL IS NORMAL AND EXPECTED: do it every time the answer is not already in the snapshot, and call several if needed. Never guess a number you have not been given.',
    toolsNeverDefer: 'You fetch data yourself. NEVER tell the user to run a command, open a console, or check Proxmox to obtain information: if you need it, call the tool that returns it. Answering "the data provided does not say" without having called a tool is a failure.',
    toolsSilent: 'Call tools freely, but never SHOW the call: no tool name, no data field name, no JSON block, and never the words "we could run". State what a value IS, never where it came from.',
    toolsAnswerNotDump: 'ANSWER WITH THE SPECIFIC FINDINGS, never in generalities. Every statement you make must carry the measured value behind it. When a tool returns findings about what can be improved, list EVERY one that bears on the question, as a short bullet, in your own words, with its figure. It is FORBIDDEN to write that improvements exist, that a problem was found, or that something should be checked, without naming each one and giving its number. A summary that names nothing is a failed answer.',
    // Narrowed to modification on purpose. The generic "you cannot execute
    // actions" made the model refuse to look data up as well.
    toolsNoWrite: 'You can read anything and CHANGE nothing: you cannot create, modify, migrate, start, stop or delete. That limit applies ONLY to changing the infrastructure, never to reading it. If the user asks for a change, explain the procedure and say they must apply it themselves via ProxCenter or Proxmox.',
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
    stoppedHeader: (n: number) => `STOPPED VMs/CTs (${n} total)`,
    stoppedCluster: (name: string, n: number) => `[${name}] (${n} stopped)`,
    stoppedTruncated: (n: number) => `... and ${n} more stopped VMs/CTs (use the guest listing tool for the full list)`,
    alertsActive: (n: number) => `Active alerts (${n})`,
    noAlerts: 'No active alerts.',
    runningHeader: (total: number, shown: boolean) => `Running VMs/CTs (${total} total${shown ? ', first 20 shown' : ''})`,
    andMore: (n: number) => `... and ${n} more running VMs/CTs`,
    cephHeader: 'Ceph',
    instructions: '=== INSTRUCTIONS ===',
    // Takes the answer language rather than hardcoding "English": this
    // English prompt body is what de, es, ko and zh-CN users get, and a
    // literal "Respond in English" here contradicted the language
    // instruction appended below (#686). Contradictory instructions are
    // followed poorly by the small local models Ollama typically serves.
    respondLang: (language: string) => `Respond in ${language} concisely`,
    useData: 'Use ONLY the data above',
    useDataOrTools: 'Use ONLY the data above or data returned by a tool call',
    // Repeated in the closing list because the tail of a prompt is weighed most.
    tailNoDump: 'Name every finding with its figure, never answer that improvements or problems merely exist, and never show or mention a tool call',
    citeNames: 'Cite exact VM names and metrics',
    explainActions: 'For actions, explain the procedure but specify you cannot execute it',
    // The generic `explainActions` above is what turned a data question into a
    // four-step "run `ceph health detail` yourself" procedure once tools were
    // attached, so with tools it is replaced by this change-scoped wording.
    explainChangesOnly: 'For a request to CHANGE something, explain the procedure and say you cannot apply it. For a question about data, call the tool instead of explaining how to look it up',
  },
  fr: {
    intro: 'Tu es l\'assistant IA de ProxCenter, une plateforme de gestion d\'infrastructure Proxmox.',
    noActions: 'IMPORTANT: Tu ne peux PAS exécuter d\'actions. Tu peux uniquement analyser et suggérer. Si l\'utilisateur demande une action, explique ce qu\'il faudrait faire mais précise qu\'il doit le faire manuellement via l\'interface ProxCenter ou Proxmox.',
    toolsIntro: 'Tu disposes d\'outils en lecture seule qui récupèrent des détails d\'infrastructure absents de l\'instantané ci-dessous : dimensionnement matériel des VMs, matériel des hôtes (interfaces réseau, disques physiques), capacité de stockage, santé Ceph, OSD et latences. APPELER UN OUTIL EST NORMAL ET ATTENDU : fais-le chaque fois que la réponse n\'est pas déjà dans l\'instantané, et appelles-en plusieurs si besoin. N\'invente jamais un chiffre qui ne t\'a pas été fourni.',
    toolsNeverDefer: 'C\'est toi qui récupères les données. Ne dis JAMAIS à l\'utilisateur de lancer une commande, d\'ouvrir une console ou d\'aller voir dans Proxmox pour obtenir une information : s\'il te la faut, appelle l\'outil qui la renvoie. Répondre « les données fournies ne le disent pas » sans avoir appelé d\'outil est un échec.',
    toolsSilent: 'Appelle les outils librement, mais n\'AFFICHE jamais l\'appel : aucun nom d\'outil, aucun nom de champ de données, aucun bloc JSON, et jamais les mots « nous pourrions exécuter ». Énonce ce qu\'une valeur EST, jamais d\'où elle vient.',
    toolsNoWrite: 'Tu peux tout lire et ne rien MODIFIER : tu ne peux pas créer, modifier, migrer, démarrer, arrêter ni supprimer. Cette limite ne porte QUE sur la modification de l\'infrastructure, jamais sur sa lecture. Si l\'utilisateur demande une modification, explique la procédure et précise qu\'il doit l\'appliquer lui-même via ProxCenter ou Proxmox.',
    toolsAnswerNotDump: 'RÉPONDS PAR LES CONSTATS PRÉCIS, jamais par des généralités. Chaque affirmation doit porter la valeur mesurée qui la fonde. Quand un outil renvoie des constats sur ce qui peut être amélioré, énumère CHACUN de ceux qui concernent la question, en une puce courte, dans tes propres mots, avec son chiffre. Il est INTERDIT d\'écrire qu\'il y a des améliorations à faire, qu\'un problème a été trouvé, ou qu\'il faut vérifier quelque chose, sans nommer chaque point et donner son chiffre. Un résumé qui ne nomme rien est une réponse ratée.',
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
    stoppedHeader: (n: number) => `VMs/CTs ARRÊTÉES (${n} total)`,
    stoppedCluster: (name: string, n: number) => `[${name}] (${n} arrêtées)`,
    stoppedTruncated: (n: number) => `... et ${n} autres VMs/CTs arrêtées (utilise l'outil de liste des invités pour la liste complète)`,
    alertsActive: (n: number) => `Alertes actives (${n})`,
    noAlerts: 'Aucune alerte active.',
    runningHeader: (total: number, shown: boolean) => `VMs/CTs en cours d'exécution (${total} total${shown ? ', 20 premières affichées' : ''})`,
    andMore: (n: number) => `... et ${n} autres VMs/CTs en cours d'exécution`,
    cephHeader: 'Ceph',
    instructions: '=== INSTRUCTIONS ===',
    // The French body is only ever used when the UI locale is `fr`, so the
    // answer language is already known here.
    respondLang: () => 'Réponds en français de manière concise',
    useData: 'Utilise UNIQUEMENT les données ci-dessus',
    useDataOrTools: 'Utilise UNIQUEMENT les données ci-dessus ou celles renvoyées par un appel d\'outil',
    tailNoDump: 'Nomme chaque constat avec son chiffre, ne réponds jamais que des améliorations ou des problèmes « existent », et n\'affiche ni ne mentionne jamais un appel d\'outil',
    citeNames: 'Cite les noms exacts des VMs et métriques',
    explainActions: 'Pour les actions, explique la procédure mais précise que tu ne peux pas l\'exécuter',
    explainChangesOnly: 'Pour une demande de MODIFICATION, explique la procédure et précise que tu ne peux pas l\'appliquer. Pour une question sur des données, appelle l\'outil au lieu d\'expliquer comment aller les chercher',
  },
}

export type RenderPromptOptions = {
  /** Whether tool definitions are attached to the request. */
  toolsEnabled?: boolean
  /** Terser host/top-list lines, for the streaming route. */
  terse?: boolean
}

/**
 * The system prompt, from an already-collected snapshot.
 *
 * Pure on purpose: the prompt is what the tests assert on, and asserting it
 * should not require mocking Proxmox, Prisma and RBAC.
 *
 * `lang` picks the fr/en prompt body; `locale` is the real UI locale and drives
 * the language the model must answer in. They differ for de, es, ko and zh-CN,
 * which read an English prompt but must get an answer in their own language
 * (#686).
 */
export function renderAiSystemPrompt(
  snapshot: AiSnapshot,
  alerts: AiAlert[],
  lang: string,
  locale: string,
  opts: RenderPromptOptions = {}
): string {
  const s = lang === 'fr' ? promptStrings.fr : promptStrings.en
  const { toolsEnabled = false, terse = false } = opts

  const running = snapshot.guests.filter(g => g.status === 'running')
  const stopped = snapshot.guests.filter(g => g.status !== 'running')

  const topCpuVMs = [...running].sort((a, b) => b.cpuPct - a.cpuPct).slice(0, 10)
  const topMemVMs = [...running].sort((a, b) => b.memPct - a.memPct).slice(0, 10)

  let prompt = `${s.intro}

${toolsEnabled
  // Order is load-bearing: what the model MAY do first, the write ban last, so
  // a limitation never leads and never reads as a general inability to act.
  ? `${s.toolsIntro}\n\n${s.toolsNeverDefer}\n\n${s.toolsAnswerNotDump}\n\n${s.toolsSilent}\n\n${s.toolsNoWrite}`
  : s.noActions}

${s.stateHeader}

📊 ${s.summary}:
- ${s.totalVMs(snapshot.summary.totalGuests, snapshot.summary.runningGuests, snapshot.summary.stoppedGuests)}
- ${s.hosts(snapshot.summary.totalNodes, snapshot.summary.onlineNodes)}
- ${s.clusters(snapshot.clusters.length, snapshot.clusters.map(c => c.name).join(', '))}
`

  if (snapshot.nodes.length > 0) {
    prompt += `
🖥️ ${s.hostsHeader}:
${snapshot.nodes.map(n => terse
  ? `- ${n.name}: ${n.status} | CPU: ${n.cpuPct}% | RAM: ${n.memPct}%`
  : `- ${n.name} (${n.cluster}): ${n.status === 'online' ? `✅ ${s.online}` : `❌ ${s.offline}`} | CPU: ${n.cpuPct}% | RAM: ${n.memPct}% (${n.memUsedGb}/${n.memTotalGb} GB)`
).join('\n')}
`
  }

  const cephClusters = snapshot.clusters.filter(c => c.cephHealth)

  if (cephClusters.length > 0) {
    prompt += `
🪣 ${s.cephHeader}:
${cephClusters.map(c => `- ${c.name}: ${c.cephHealth}`).join('\n')}
`
  }

  if (topCpuVMs.length > 0) {
    prompt += `
🔥 ${s.topCpu}:
${topCpuVMs.map((vm, i) => terse
  ? `${i + 1}. ${vm.name} (${vm.vmid}) - ${vm.cpuPct}%`
  : `${i + 1}. ${vm.name} (${vm.type} ${vm.vmid}) ${s.on} ${vm.node} - CPU: ${vm.cpuPct}% | RAM: ${vm.memPct}%`
).join('\n')}
`
  }

  if (topMemVMs.length > 0) {
    prompt += `
💾 ${s.topRam}:
${topMemVMs.map((vm, i) => terse
  ? `${i + 1}. ${vm.name} (${vm.vmid}) - ${vm.memPct}%`
  : `${i + 1}. ${vm.name} (${vm.type} ${vm.vmid}) ${s.on} ${vm.node} - RAM: ${vm.memPct}% (${vm.memUsedGb}/${vm.memTotalGb} GB)`
).join('\n')}
`
  }

  if (alerts.length > 0) {
    prompt += `
⚠️ ${s.alertsActive(alerts.length)}:
${alerts.map(a => `- [${a.severity?.toUpperCase()}] ${a.message} (${a.entityName || a.entityType})`).join('\n')}
`
  } else {
    prompt += `
✅ ${s.noAlerts}
`
  }

  if (running.length > 0) {
    const shown = running.slice(0, RUNNING_GUEST_PROMPT_CAP)

    prompt += `
📋 ${s.runningHeader(running.length, running.length > RUNNING_GUEST_PROMPT_CAP)}:
${shown.map(vm => `- ${vm.name} (${vm.type} ${vm.vmid}) ${s.on} ${vm.node} - CPU: ${vm.cpuPct}% | RAM: ${vm.memPct}%`).join('\n')}
${running.length > RUNNING_GUEST_PROMPT_CAP ? `\n${s.andMore(running.length - RUNNING_GUEST_PROMPT_CAP)}` : ''}
`
  }

  if (stopped.length > 0) {
    // The original listed every stopped guest, unbounded, which on a large
    // estate crowded out everything else in the context window. Now that the
    // model can ask for the rest, the list is capped.
    const shown = stopped.slice(0, STOPPED_GUEST_PROMPT_CAP)
    const byCluster: Record<string, AiGuest[]> = {}

    for (const vm of shown) {
      if (!byCluster[vm.cluster]) byCluster[vm.cluster] = []
      byCluster[vm.cluster].push(vm)
    }

    prompt += `
⏹️ ${s.stoppedHeader(stopped.length)}:
${Object.entries(byCluster).map(([cluster, vms]) => `
${s.stoppedCluster(cluster, vms.length)}:
${vms.map(vm => `  - ${vm.name} (${vm.type} ${vm.vmid}) ${s.on} ${vm.node}`).join('\n')}`).join('\n')}
${stopped.length > STOPPED_GUEST_PROMPT_CAP ? `\n${s.stoppedTruncated(stopped.length - STOPPED_GUEST_PROMPT_CAP)}` : ''}
`
  }

  prompt += `
${s.instructions}
- ${s.respondLang(localeToLanguageName(locale))}
- ${toolsEnabled ? s.useDataOrTools : s.useData}
- ${s.citeNames}
- ${toolsEnabled ? s.explainChangesOnly : s.explainActions}${toolsEnabled ? `\n- ${s.tailNoDump}` : ''}

${languageInstruction(locale)}
`

  return prompt
}

/** Collect, then render. The shape both chat routes call. */
export async function buildAiSystemPrompt(
  lang: string,
  locale: string,
  opts: RenderPromptOptions = {}
): Promise<{ prompt: string; snapshot: AiSnapshot }> {
  const [snapshot, alerts] = await Promise.all([collectAiSnapshot(), collectActiveAlerts()])

  return { prompt: renderAiSystemPrompt(snapshot, alerts, lang, locale, opts), snapshot }
}
