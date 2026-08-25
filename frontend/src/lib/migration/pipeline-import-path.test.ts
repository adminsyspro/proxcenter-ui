import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Regression guard for #292: on file-based storage the cold pipelines used to
 * finish with their own `qm disk import`, a second full copy of a disk that the
 * conversion had already written into the target storage. That command now lives
 * ONLY in the shared adopt-file-volume module, which renames the image into the
 * storage when it can and imports when it cannot.
 *
 * The two pipelines are 3000-line closures over SSH and Prisma with no unit
 * harness, so this guard works on their source: nobody may quietly reintroduce a
 * local `qm disk import` (and with it the double copy and the rm -f that would
 * delete an adopted disk).
 */
const PIPELINES = ["pipeline.ts", "xcpng-pipeline.ts"] as const

const sources = Object.fromEntries(
  PIPELINES.map((name) => [name, readFileSync(new URL(`./${name}`, import.meta.url), "utf8")]),
) as Record<(typeof PIPELINES)[number], string>

describe.each(PIPELINES)("%s import path (#292)", (name) => {
  const source = sources[name]

  it("does not build a qm disk import command itself", () => {
    // A built command always interpolates the vmid right after the verb
    // (`qm disk import ${targetVmid} ...`); the prose mentions of qm disk import
    // in comments never do, so they stay allowed.
    expect(source).not.toContain("qm disk import ${")
  })

  it("routes file volumes through the shared rename-or-import module", () => {
    expect(source).toMatch(/import \{[^}]*importOrAdoptFileVolume[^}]*\} from "\.\/adopt-file-volume"/)
    expect(source).toContain("await importOrAdoptFileVolume(")
  })
})
