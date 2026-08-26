import type { SSHResult } from "@/lib/ssh/exec"

export type PollOutcome =
  | { state: "running" }
  | { state: "exited"; exitCode: number }
  | { state: "unknown"; reason: string }

/** Consecutive unreadable polls tolerated before a transfer is declared lost. */
export const MAX_CONSECUTIVE_POLL_FAILURES = 5

/**
 * Interpret the result of `cat <exitfile> 2>/dev/null || echo RUNNING` run over SSH.
 * A failed SSH call (orchestrator timeout, dropped session), an empty output or
 * anything that is not a plain integer is "unknown": the remote process may very
 * well still be running, so the caller keeps polling and only gives up after
 * MAX_CONSECUTIVE_POLL_FAILURES in a row. Reading such a result as "exit code 1"
 * is what deleted a healthy download under curl (#804).
 */
export function interpretPollExit(res: SSHResult): PollOutcome {
  const out = (res.output ?? "").trim()
  if (res.success && out === "RUNNING") return { state: "running" }
  if (res.success && /^\d+$/.test(out)) return { state: "exited", exitCode: Number.parseInt(out, 10) }
  const reason = res.error || (out ? `unexpected output "${out.slice(0, 80)}"` : "empty output")
  return { state: "unknown", reason }
}
