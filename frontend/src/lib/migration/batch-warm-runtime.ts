/**
 * Warm runtime of the target nodes of a batch (roadmap#174).
 *
 * A warm job checks its node for the runtime it reads the source with (the
 * VDDK stack for VMware, the NBD toolchain for XCP-ng) only at planning, so a
 * batch aimed at an unprepared node used to start and fail every job one
 * second later. POST /batches now runs the same check as the single-VM
 * preflight (warm-check) once per distinct node, before creating anything,
 * and refuses the batch when a node is not ready.
 */
import { runWarmNodePreflight } from "@/lib/migration/warm/vddk-preflight"
import { runXcpngWarmNodePreflight } from "@/lib/migration/warm/xcpng-node-preflight"
import { checkWarmSourceVersion, fetchSourceApiVersion, warmSourceVersionError } from "@/lib/migration/warm/source-version"
import { mapBounded } from "@/lib/migration/batch-disk-sizes"

export const WARM_RUNTIME_CONCURRENCY = 4
export const WARM_RUNTIME_DEADLINE_MS = 30_000

export interface WarmRuntimeProblem { node: string; missing: string[]; message: string }

/**
 * Nodes of the batch that cannot run a warm job, with the reason. An empty
 * list means every node is ready. A node whose probe did not answer before
 * the deadline counts as not ready: the batch would otherwise start blind.
 */
export async function checkBatchWarmRuntime(input: {
  sourceConnectionId: string
  sourceType: string
  targetConnectionId: string
  nodes: string[]
}): Promise<WarmRuntimeProblem[]> {
  const nodes = [...new Set(input.nodes)]
  const nbd = input.sourceType === "xcpng"
  // The source version is the same for every node; only the VDDK each node
  // carries changes the verdict (#946).
  const sourceVersion = nbd ? "" : await fetchSourceApiVersion(input.sourceConnectionId).catch(() => "")
  const verdicts = await mapBounded(nodes, WARM_RUNTIME_CONCURRENCY, Date.now() + WARM_RUNTIME_DEADLINE_MS, async node => {
    if (nbd) return runXcpngWarmNodePreflight(input.targetConnectionId, node)
    const result = await runWarmNodePreflight(input.targetConnectionId, node)
    const source = checkWarmSourceVersion({ sourceApiVersion: sourceVersion, vddkLibPath: result.vddkLib })
    return source.blocked ? { ...result, ok: false, error: warmSourceVersionError(source) } : result
  })
  const problems: WarmRuntimeProblem[] = []
  nodes.forEach((node, i) => {
    const v = verdicts[i]
    if (v === null) {
      problems.push({ node, missing: [], message: `${node}: the warm-migration readiness check failed or did not answer in time` })
    } else if (!v.ok) {
      const why = v.error || (v.missing.length ? `missing ${v.missing.join(", ")}` : "not ready")
      problems.push({ node, missing: v.missing, message: `${node} is not ready for warm migration: ${why}` })
    }
  })
  return problems
}
