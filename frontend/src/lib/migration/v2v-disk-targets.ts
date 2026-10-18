/**
 * Per-disk target storage and disk exclusion on the virt-v2v path (#317, lot 2).
 *
 * virt-v2v writes every converted disk into `-o local -os <outputDir>` and has
 * no option to leave a disk out, so an excluded disk is still read and
 * converted. The per-disk choices therefore apply in the import step that
 * follows the conversion: the output files are named <name>-sda, -sdb, ... in
 * source order, so output file i is the converted source disk i. It is imported
 * onto the storage chosen for source disk i (adopted in place when it was
 * staged on that very storage, `qm disk import` or a raw block write
 * otherwise), or left in the output directory, which the pipeline removes
 * whole. Nothing is moved between storages after the fact.
 */
import { planDiskTargets, type MigrationDiskMapping } from "./target-overrides"

export interface V2vDiskImport {
  /** Position of the disk in the source VM's disk list, which is also its position in virt-v2v's output. */
  sourceIndex: number
  /** Converted file name under the output directory. */
  file: string
  /** PVE storage the disk is imported onto. */
  storage: string
  /** Position among the imported disks (0 = boot disk): numbers the bus slots without gaps. */
  slotIndex: number
  /** Source capacity for the integrity check, when the source disk list is known and lines up with the output. */
  capacityBytes?: number
}

export interface V2vImportPlan {
  /** The disks to import, in source order. */
  imports: V2vDiskImport[]
  /** The output files the operator left out of the migration. */
  excluded: Array<{ sourceIndex: number; file: string }>
}

/**
 * Distribute virt-v2v's output files over the target storages.
 *
 * `sourceDisks` is the source VM's disk list when the pipeline knows it (null
 * on the paths that do not read the source config). With per-disk choices the
 * list must be known and have exactly one entry per output file: the choices
 * are positions in that list, so anything else means they cannot be matched to
 * the converted disks and the job must fail before importing rather than guess.
 * Without choices every file goes to `defaultStorage`, as before.
 */
export function planV2vImports(
  diskFiles: readonly string[],
  sourceDisks: readonly { capacityBytes: number }[] | null,
  mappings: MigrationDiskMapping[] | undefined,
  defaultStorage: string,
): V2vImportPlan {
  const hasMappings = (mappings?.length ?? 0) > 0
  if (hasMappings && !sourceDisks) {
    throw new Error(
      "The per-disk storage choices cannot be applied: the source VM's disk list is not known on this path. " +
      "Nothing was imported; retry with every disk on the default storage.",
    )
  }
  if (hasMappings && sourceDisks && sourceDisks.length !== diskFiles.length) {
    throw new Error(
      `The per-disk storage choices cannot be matched to the converted disks: the source VM has ${sourceDisks.length} disk(s) ` +
      `but virt-v2v produced ${diskFiles.length} disk file(s) (${diskFiles.join(", ")}). ` +
      "Nothing was imported; retry with every disk on the default storage.",
    )
  }
  // The capacities feed the integrity check only when the two lists line up.
  const sizes = sourceDisks && sourceDisks.length === diskFiles.length ? sourceDisks : null
  const plan = planDiskTargets(diskFiles, hasMappings ? mappings : undefined, defaultStorage)
  return {
    imports: plan.kept.map((k, slotIndex) => ({
      sourceIndex: k.sourceIndex,
      file: k.disk,
      storage: k.storage,
      slotIndex,
      capacityBytes: sizes?.[k.sourceIndex]?.capacityBytes,
    })),
    excluded: plan.excluded.map(i => ({ sourceIndex: i, file: diskFiles[i] })),
  }
}

/**
 * Bus slot of the n-th imported disk. A Windows boot disk goes on sata0 and
 * the data disks follow on scsi0, scsi1...; without `--block-driver` support
 * every disk is virtio-blk (virtioN); otherwise scsiN.
 */
export function v2vDiskSlot(slotIndex: number, bus: { winSataBoot: boolean; virtioBlk: boolean }): string {
  if (bus.winSataBoot) return slotIndex === 0 ? "sata0" : `scsi${slotIndex - 1}`
  if (bus.virtioBlk) return `virtio${slotIndex}`
  return `scsi${slotIndex}`
}
