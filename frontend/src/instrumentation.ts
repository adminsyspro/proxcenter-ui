// Next.js instrumentation hook. The Node-only body lives in
// instrumentation-node.ts behind a positive NEXT_RUNTIME check: Turbopack can
// tree-shake the Edge bundle on `=== 'nodejs'` but not on the negative form,
// which produced spurious edge-runtime warnings on every dev boot.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('./instrumentation-node')
    await registerNode()
  }
}
