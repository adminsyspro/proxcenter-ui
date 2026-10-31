/**
 * Ollama models qualified for the assistant, and the verdict the settings
 * "Test connection" button gives on the configured one (#459).
 *
 * Pure data and arithmetic, no server import: the settings page marks the
 * qualified models in its picker with this list.
 *
 * Qualified means measured against the lab (two PVE clusters, two Ceph
 * clusters), 12 questions in English and 12 in French scored against the real
 * values, plus four "Can you do that?" follow-ups: no figure invented, at most
 * one miscount, every follow-up a refusal to act. Measured on 30/10/2026,
 * Ollama 0.40.6:
 *
 * - llama3.1:8b got every figure right but misread the follow-up four times
 *   out of four, replaying the lookup or answering "that is a joke".
 * - gemma4:12b invented a 1.2 TB storage and a 125 ms OSD latency without
 *   calling a tool. gpt-oss:20b ran out of rounds on "most consumed space"
 *   twice and named the wrong storage once.
 * - qwen3.5:9b lost one count and once returned an empty turn, which the chat
 *   loops now retry; it is still the best model that fits a 12 GB card.
 */

export type QualifiedOllamaModel = {
  /** The tag as `ollama pull` takes it. */
  model: string
  /** Size Ollama reports in /api/ps once loaded with OLLAMA_NUM_CTX, in GB. */
  loadedGb: number
}

/** Smallest first: the default is the one most servers can run. */
export const QUALIFIED_OLLAMA_MODELS: readonly QualifiedOllamaModel[] = [
  { model: 'qwen3.5:9b', loadedGb: 6.2 },
  { model: 'mistral-small3.2:24b', loadedGb: 17.2 },
  { model: 'qwen3.6:35b-a3b', loadedGb: 22.2 },
]

export const DEFAULT_OLLAMA_MODEL = QUALIFIED_OLLAMA_MODELS[0].model

export function isQualifiedOllamaModel(model: string): boolean {
  return QUALIFIED_OLLAMA_MODELS.some(q => q.model === model)
}

/** Under this generation speed the operator waits tens of seconds per answer. */
export const SLOW_TOKENS_PER_SECOND = 10

/**
 * Ollama loads a model on the GPU whole or spills the remaining layers to the
 * CPU. Rounding in its own size accounting leaves a fully offloaded model a
 * hair under 100 %, hence the margin.
 */
const FULL_GPU_SHARE = 0.99

/** Slack on the recorded footprints, see `preflightVerdict`. */
const FOOTPRINT_TOLERANCE = 1.05

export type PreflightIssue = 'not-qualified' | 'cpu-offload' | 'slow'

export type PreflightMeasure = {
  model: string
  /** From /api/ps: total size and the part on the GPU, in bytes. null when the model was not listed. */
  sizeBytes: number | null
  sizeVramBytes: number | null
  /** From the probe answer: eval_count / eval_duration. null when the server did not report it. */
  tokensPerSecond: number | null
}

export type PreflightVerdict = {
  model: string
  qualified: boolean
  /** Share of the loaded model on the GPU, 0 to 1. null when unknown. */
  gpuShare: number | null
  tokensPerSecond: number | null
  issues: PreflightIssue[]
  /**
   * Qualified models known to fit this server, largest first. Ollama reports
   * no GPU memory size, only how much of the probed model it placed there, so
   * that is a lower bound of what is free: a model at most that size fits,
   * anything larger is unknown and never suggested.
   */
  fits: string[]
}

const GB = 1e9

export function preflightVerdict(measure: PreflightMeasure): PreflightVerdict {
  const { model, sizeBytes, sizeVramBytes, tokensPerSecond } = measure
  const qualified = isQualifiedOllamaModel(model)
  const issues: PreflightIssue[] = []

  const gpuShare = sizeBytes && sizeVramBytes !== null ? Math.min(1, sizeVramBytes / sizeBytes) : null

  if (!qualified) issues.push('not-qualified')
  if (gpuShare !== null && gpuShare < FULL_GPU_SHARE) issues.push('cpu-offload')
  if (tokensPerSecond !== null && tokensPerSecond < SLOW_TOKENS_PER_SECOND) issues.push('slow')

  const knownFreeGb = sizeVramBytes !== null ? sizeVramBytes / GB : null
  const wholeOnGpu = gpuShare !== null && gpuShare >= FULL_GPU_SHARE

  // The footprints were measured on one Ollama release and move a few percent
  // with the next one: qwen3.5:9b loaded at 6.15 GB against 6.2 recorded.
  const fits = knownFreeGb === null
    ? []
    : QUALIFIED_OLLAMA_MODELS
      .filter(q => q.loadedGb <= knownFreeGb * FOOTPRINT_TOLERANCE || (q.model === model && wholeOnGpu))
      .map(q => q.model)
      .reverse()

  return {
    model,
    qualified,
    gpuShare,
    tokensPerSecond: tokensPerSecond === null ? null : Math.round(tokensPerSecond * 10) / 10,
    issues,
    fits,
  }
}
