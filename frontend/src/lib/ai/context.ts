/**
 * System prompt for the AI assistant: the orientation digest built from the
 * inventory snapshot (`@/lib/tools/snapshot`) and the active alerts.
 *
 * `ai/chat` and `ai/chat/stream` used to carry their own copy of the
 * gathering + prompt code, and the copies had already drifted apart. Both
 * routes now render from here.
 */
import { loadScopedAlerts } from '@/lib/tools/alerts'
import { collectInventorySnapshot, type InventorySnapshot, type SnapshotGuest } from '@/lib/tools/snapshot'
import { languageInstruction, localeToLanguageName } from '@/lib/ai/locale'

/** How many stopped guests the prompt lists before deferring to a tool call. */
export const STOPPED_GUEST_PROMPT_CAP = 40

/** How many running guests the prompt lists. Unchanged from the original. */
export const RUNNING_GUEST_PROMPT_CAP = 20

export type AiAlert = {
  severity?: string | null
  message?: string | null
  entityName?: string | null
  entityType?: string | null
  metric?: string | null
  currentValue?: number | null
  threshold?: number | null
}

/** The prompt's alerts: scoped like the alerts page, see `loadScopedAlerts`. */
export async function collectActiveAlerts(snapshot: InventorySnapshot): Promise<AiAlert[]> {
  return loadScopedAlerts(snapshot, { limit: 10 })
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
    toolsIntro: 'You have read-only tools that fetch infrastructure details absent from the snapshot below: VM hardware sizing, host hardware (network interfaces, physical disks), storage capacity, Ceph health, OSDs and latency, the history of one host or VM over a period (CPU, memory, network, disk I/O), capacity and over-commitment, the alerts, which guests no backup job protects, the Proxmox tasks of the last days (failed backups, migrations, what runs now), the configuration changes (who changed what), pending updates, subscriptions and certificates, HA and quorum, DRS and Site Recovery, migration jobs, vDC quotas, CVE exposure, capacity forecasts and what-if placement. The user sees the history and the rankings drawn as charts under your answer: when asked for a graph or a curve, call the tool, never say you cannot draw. CALLING A TOOL IS NORMAL AND EXPECTED: do it every time the answer is not already in the snapshot, and call several if needed. Never guess a number you have not been given.',
    toolsNeverDefer: 'You fetch data yourself. NEVER tell the user to run a command, open a console, or check Proxmox to obtain information: if you need it, call the tool that returns it. Answering "the data provided does not say" without having called a tool is a failure.',
    toolsSilent: 'Call tools freely, but never SHOW the call: no tool name, no data field name, no JSON block, and never the words "we could run". State what a value IS, never where it came from.',
    toolsAnswerNotDump: 'ANSWER WITH THE SPECIFIC FINDINGS, never in generalities. Every statement you make must carry the measured value behind it. When a tool returns findings about what can be improved, list EVERY one that bears on the question, as a short bullet, in your own words, with its figure. It is FORBIDDEN to write that improvements exist, that a problem was found, or that something should be checked, without naming each one and giving its number. A summary that names nothing is a failed answer.',
    // Narrowed to modification on purpose. The generic "you cannot execute
    // actions" made the model refuse to look data up as well.
    actionsPropose: 'You change nothing yourself and never execute anything: you can only propose an action with propose_action or propose_remediation_plan when the user explicitly asks for one, and the user approves it on the card shown under your answer. Never claim an action was done.',
    explainChangesOnlyActions: 'For a request to change something, propose the action with propose_action when the user explicitly asks for it and it is one you can propose; otherwise explain the procedure and say the user must apply it themselves',
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
    // The totals in parentheses above are what a small model reads as "assigned
    // memory" and answers from, missing the guest with the most RAM assigned
    // when it sits idle outside the top 10 (qwen2.5:7b and qwen3:8b, #459).
    topListsCaveat: 'The two rankings above are by current USAGE only. They are not the list of the biggest guests: for the most vCPUs, memory or disk ASSIGNED to a guest, call the hardware ranking tool, even when a guest above shows a total.',
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
    toolsIntro: 'Tu disposes d\'outils en lecture seule qui récupèrent des détails d\'infrastructure absents de l\'instantané ci-dessous : dimensionnement matériel des VMs, matériel des hôtes (interfaces réseau, disques physiques), capacité de stockage, santé Ceph, OSD et latences, l\'historique d\'un hôte ou d\'une VM sur une période (CPU, mémoire, réseau, E/S disque), la capacité et le surengagement, les alertes, les VM qu\'aucun job de sauvegarde ne protège, les tâches Proxmox des derniers jours (sauvegardes en échec, migrations, ce qui tourne maintenant), les changements de configuration (qui a modifié quoi), les mises à jour en attente, souscriptions et certificats, la HA et le quorum, le DRS et Site Recovery, les jobs de migration, les quotas vDC, l\'exposition aux CVE, les prévisions de capacité et les simulations de placement. L\'utilisateur voit l\'historique et les classements dessinés en graphiques sous ta réponse : quand on te demande un graphique ou une courbe, appelle l\'outil, ne dis jamais que tu ne peux pas dessiner. APPELER UN OUTIL EST NORMAL ET ATTENDU : fais-le chaque fois que la réponse n\'est pas déjà dans l\'instantané, et appelles-en plusieurs si besoin. N\'invente jamais un chiffre qui ne t\'a pas été fourni.',
    toolsNeverDefer: 'C\'est toi qui récupères les données. Ne dis JAMAIS à l\'utilisateur de lancer une commande, d\'ouvrir une console ou d\'aller voir dans Proxmox pour obtenir une information : s\'il te la faut, appelle l\'outil qui la renvoie. Répondre « les données fournies ne le disent pas » sans avoir appelé d\'outil est un échec.',
    toolsSilent: 'Appelle les outils librement, mais n\'AFFICHE jamais l\'appel : aucun nom d\'outil, aucun nom de champ de données, aucun bloc JSON, et jamais les mots « nous pourrions exécuter ». Énonce ce qu\'une valeur EST, jamais d\'où elle vient.',
    actionsPropose: 'Tu ne modifies rien toi-même et n\'exécutes jamais rien : tu peux seulement proposer une action avec propose_action ou propose_remediation_plan quand l\'utilisateur en demande explicitement une, et l\'utilisateur l\'approuve sur la carte affichée sous ta réponse. Ne prétends jamais qu\'une action a été faite.',
    explainChangesOnlyActions: 'Pour une demande de modification, propose l\'action avec propose_action quand l\'utilisateur la demande explicitement et que tu peux la proposer ; sinon explique la procédure et précise qu\'il doit l\'appliquer lui-même',
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
    topListsCaveat: 'Les deux classements ci-dessus portent sur l\'UTILISATION courante uniquement. Ce ne sont pas les plus grosses VMs : pour le plus de vCPU, de mémoire ou de disque ASSIGNÉS à un invité, appelle l\'outil de classement matériel, même si un invité ci-dessus affiche un total.',
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
  /** The proposal tools are attached (roadmap#188): adds the two sentences saying how they work. */
  actionsEnabled?: boolean
}

const withoutReadOnlyClaim = (text: string) => text.replace('read-only tools', 'tools').replace('outils en lecture seule', 'outils')

const terseHostLine = (n: InventorySnapshot['nodes'][number]) => `- ${n.name}: ${n.status} | CPU: ${n.cpuPct}% | RAM: ${n.memPct}%`

function hostLine(n: InventorySnapshot['nodes'][number], s: { online: string; offline: string }) {
  const state = n.status === 'online' ? `✅ ${s.online}` : `❌ ${s.offline}`

  return `- ${n.name} (${n.cluster}): ${state} | CPU: ${n.cpuPct}% | RAM: ${n.memPct}% (${n.memUsedGb}/${n.memTotalGb} GB)`
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
  snapshot: InventorySnapshot,
  alerts: AiAlert[],
  lang: string,
  locale: string,
  opts: RenderPromptOptions = {}
): string {
  const s = lang === 'fr' ? promptStrings.fr : promptStrings.en
  const { toolsEnabled = false, terse = false, actionsEnabled = false } = opts

  const running = snapshot.guests.filter(g => g.status === 'running')
  const stopped = snapshot.guests.filter(g => g.status !== 'running')

  const topCpuVMs = [...running].sort((a, b) => b.cpuPct - a.cpuPct).slice(0, 10)
  const topMemVMs = [...running].sort((a, b) => b.memPct - a.memPct).slice(0, 10)

  let prompt = `${s.intro}

${toolsEnabled
  // Order is load-bearing: what the model MAY do first, the write ban last, so
  // a limitation never leads and never reads as a general inability to act.
  // With actions on, the read-only claims and the write ban are SWAPPED, not
  // appended to: a small model obeys the nearest, most repeated instruction.
  ? `${actionsEnabled ? withoutReadOnlyClaim(s.toolsIntro) : s.toolsIntro}\n\n${s.toolsNeverDefer}\n\n${s.toolsAnswerNotDump}\n\n${s.toolsSilent}\n\n${actionsEnabled ? s.actionsPropose : s.toolsNoWrite}`
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
${snapshot.nodes.map(n => (terse ? terseHostLine(n) : hostLine(n, s))).join('\n')}
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

  if (toolsEnabled && (topCpuVMs.length > 0 || topMemVMs.length > 0)) {
    prompt += `
${s.topListsCaveat}
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
    const byCluster: Record<string, SnapshotGuest[]> = {}

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
- ${toolsEnabled ? (actionsEnabled ? s.explainChangesOnlyActions : s.explainChangesOnly) : s.explainActions}${toolsEnabled ? `\n- ${s.tailNoDump}` : ''}

${languageInstruction(locale)}
`

  return prompt
}

/** Collect, then render. The shape both chat routes call. */
export async function buildAiSystemPrompt(
  lang: string,
  locale: string,
  opts: RenderPromptOptions = {}
): Promise<{ prompt: string; snapshot: InventorySnapshot }> {
  // The alerts are filtered on the snapshot, so they come after it.
  const snapshot = await collectInventorySnapshot()
  const alerts = await collectActiveAlerts(snapshot)

  return { prompt: renderAiSystemPrompt(snapshot, alerts, lang, locale, opts), snapshot }
}
