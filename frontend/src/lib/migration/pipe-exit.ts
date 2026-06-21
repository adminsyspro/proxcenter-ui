/**
 * Exit-code capture for two-stage `producer | dd` streaming pipelines.
 *
 * Migration disks are streamed to block devices with a shell pipeline such
 * as `curl ... | dd of=/dev/zvol/...` (HTTPS transfer) or
 * `ssh ... dd | dd of=/dev/zvol/...` (SSH transfer). We need the exit code
 * of BOTH stages: the producer (curl/ssh) tells us about upstream failures
 * (HTTP/TLS/RST, NFC lease expiry) and dd tells us about the local write
 * (ENOSPC, I/O error).
 *
 * The naive way to read them is fatally wrong:
 *
 *     curl ... | dd ...
 *     CURL_EXIT=${PIPESTATUS[0]}   # ok, reads curl's code
 *     DD_EXIT=${PIPESTATUS[1]}     # BUG: always empty
 *
 * `PIPESTATUS` reflects only the most-recently-executed pipeline, and a bare
 * assignment like `CURL_EXIT=${PIPESTATUS[0]}` is itself a command that
 * RESETS `PIPESTATUS` to `(0)`. By the time `${PIPESTATUS[1]}` is read it is
 * unset → `DD_EXIT` is empty. The JS poller then sees a blank exit file and
 * defaults it to a bogus "exit code 1", so a fully successful transfer (full
 * disk copied, `records in == records out`) is reported as a failure.
 *
 * The fix is to snapshot the whole array in ONE command immediately after the
 * pipeline, then read from the snapshot. The producer's code wins when
 * non-zero (it is the upstream cause); otherwise dd's code is reported.
 */

/**
 * Snapshot the exit codes of the immediately-preceding pipeline.
 *
 * MUST be emitted as the very next command after the `producer | dd`
 * pipeline, before any other command (including cleanup), or `PIPESTATUS`
 * will already have been clobbered.
 */
export function capturePipelineStatus(): string {
  return `__PS=("\${PIPESTATUS[@]}")`
}

/**
 * Write the effective exit code of the captured pipeline to `exitFile`.
 * Pair with {@link capturePipelineStatus}, which must run right after the
 * pipeline. Safe to emit after intervening commands (e.g. cleanup) because it
 * reads the `__PS` snapshot rather than the live `PIPESTATUS`.
 */
export function writePipelineExit(exitFile: string): string {
  return `if [ "\${__PS[0]}" -ne 0 ]; then echo "\${__PS[0]}" > "${exitFile}"; else echo "\${__PS[1]:-1}" > "${exitFile}"; fi`
}
