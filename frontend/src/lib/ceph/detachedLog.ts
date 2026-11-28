/*
   Reading the log a detached pveceph leaves in the SSH account's
   $HOME/.cache/proxcenter (ui#1450): the exit code it ends with, and its
   output. Pure, so the browser may use it too (lib/ceph/detachedPveceph runs
   the commands, on the server only).
*/

const EXIT_RE = /PXC_EXIT:(\d+)/

/** The exit code a finished detached command wrote, null while it runs. */
export function detachedExit(log: string): number | null {
  const m = EXIT_RE.exec(log)
  return m ? Number(m[1]) : null
}

/** The log without its exit marker, the last `lines` lines. */
export function detachedOutput(log: string, lines = 20): string {
  return log.split('\n').filter(l => l.trim() !== '' && !EXIT_RE.test(l)).slice(-lines).join('\n')
}
