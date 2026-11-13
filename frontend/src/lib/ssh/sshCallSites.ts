// Inventory of the frontend's SSH call sites, for the guard test of
// ssh-call-sites.json. A call site is a call to one of the executors below
// outside a test; their own definitions do not count.

export const SSH_EXECUTORS = ['executeSSH', 'executeSSHDirect', 'executeSSHWithTimeout', 'runSshForWatcher'] as const

const CALL = new RegExp(`\\b(${SSH_EXECUTORS.join('|')})\\s*\\(`, 'g')

/** Number of SSH executor calls in one source file. */
export function countSshCalls(source: string): number {
  let n = 0

  for (const m of source.matchAll(CALL)) {
    const before = source.slice(Math.max(0, m.index - 30), m.index)

    if (/function\s*$/.test(before)) continue
    n++
  }

  return n
}

export function isSourceFile(path: string): boolean {
  return /\.(ts|tsx|js|jsx)$/.test(path) && !/\.test\.(ts|tsx|js|jsx)$/.test(path) && !/__(tests|mocks)__/.test(path)
}
