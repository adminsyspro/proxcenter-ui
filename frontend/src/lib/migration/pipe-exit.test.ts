import { describe, it, expect } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { capturePipelineStatus, writePipelineExit } from "./pipe-exit"

describe("pipe-exit snippet builders", () => {
  it("captures the whole PIPESTATUS array in one command", () => {
    // The fix hinges on snapshotting the array atomically. A per-element
    // read (`X=${PIPESTATUS[0]}`) resets PIPESTATUS and loses dd's code.
    expect(capturePipelineStatus()).toBe('__PS=("${PIPESTATUS[@]}")')
  })

  it("reads exit codes from the snapshot, not live PIPESTATUS", () => {
    const snippet = writePipelineExit("/tmp/x.exit")
    expect(snippet).toContain("${__PS[0]}")
    expect(snippet).toContain("${__PS[1]")
    expect(snippet).not.toContain("PIPESTATUS")
  })

  it("prefers the producer's code, falling back to dd's", () => {
    const snippet = writePipelineExit("/tmp/x.exit")
    // producer (stage 0) non-zero -> report it; else dd (stage 1)
    expect(snippet).toContain('if [ "${__PS[0]}" -ne 0 ]')
    expect(snippet).toContain('echo "${__PS[0]}" > "/tmp/x.exit"')
    expect(snippet).toContain('echo "${__PS[1]:-1}" > "/tmp/x.exit"')
  })
})

/**
 * Behavioural test: run the generated snippet through a real bash and assert
 * the recorded exit code. `( exit A ) | ( cat >/dev/null; exit B )` yields a
 * pipeline whose PIPESTATUS is (A, B) without needing curl/dd. This is the
 * regression that bit issue: a successful transfer (0,0) was reported as 1.
 */
function runPipeline(producerCode: number, ddCode: number): string {
  const dir = mkdtempSync(join(tmpdir(), "pipe-exit-"))
  const exitFile = join(dir, "ctrl.pid.exit")
  try {
    const script = [
      `( exit ${producerCode} ) | ( cat >/dev/null; exit ${ddCode} )`,
      capturePipelineStatus(),
      // an intervening command (mirrors cleanupCmd in the SSH path) that
      // would clobber live PIPESTATUS — the snapshot must survive it
      `true`,
      writePipelineExit(exitFile),
    ].join("\n")
    execFileSync("bash", ["-c", script])
    return readFileSync(exitFile, "utf8").trim()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("pipe-exit recorded code (real bash)", () => {
  it("records 0 when curl AND dd both succeed (the false-failure regression)", () => {
    expect(runPipeline(0, 0)).toBe("0")
  })

  it("records the producer's code when curl/ssh fails", () => {
    expect(runPipeline(18, 0)).toBe("18") // curl 18 = partial transfer
  })

  it("records dd's code when the producer succeeds but dd fails", () => {
    expect(runPipeline(0, 1)).toBe("1") // dd 1 = write error (e.g. ENOSPC)
  })

  it("prefers the producer's code when both fail", () => {
    expect(runPipeline(56, 1)).toBe("56") // curl 56 = recv error
  })
})
