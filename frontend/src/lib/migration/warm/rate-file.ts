// nbdkit's rate filter on a warm reader (copy-rate.ts): its arguments and the
// rate file the engine rewrites to change the cap while the copy runs.

import { shellEscape } from "@/lib/ssh/exec"

import { nbdkitRateArg } from "./copy-rate"

/** The rate file of the reader serving `sock`. Removed with the reader. */
export function rateFileOf(sock: string): string {
  return `${sock}.rate`
}

/**
 * Filter and parameters to put in the nbdkit command. The filter is always
 * there, so a cap set while a pass runs reaches it. nbdkit refuses `rate=0` at
 * startup: without a share the filter only watches its file, which it reads
 * as unlimited until one is written (both checked on the lab, nbdkit 1.42).
 */
export function nbdkitRateFilterArgs(sock: string, initialMbps: number): { filters: string[]; params: string[] } {
  const params = initialMbps > 0 ? [`rate=${nbdkitRateArg(initialMbps)}`] : []
  params.push(`rate-file=${shellEscape(rateFileOf(sock))}`)
  // nbdkit's default credit (2 s of the cap) is kept: a smaller one loses
  // throughput at low caps, reads coming in 4 MiB blocks (lab 16/11: 0.3 MiB/s
  // for a 2 MiB/s cap with 0.25 s). The start burst it allows is kept out of
  // the job's throughput readout instead (apply.ts).
  return { filters: ["--filter=rate"], params }
}

/** Rewrite the rate file atomically (the filter's documented way), 0 lifting the cap. */
export function buildRateFileWriteCmd(sock: string, mbps: number): string {
  const file = rateFileOf(sock)
  const tmp = `${file}.tmp`
  return `printf '%s\\n' ${nbdkitRateArg(mbps)} > ${shellEscape(tmp)} && mv -f ${shellEscape(tmp)} ${shellEscape(file)}`
}
