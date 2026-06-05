/** Parse the X.Y.Z version from a Broadcom VDDK tarball filename, or null. */
export function parseVddkVersion(filename: string): string | null {
  const m = filename.match(/vix-disklib-(\d+\.\d+\.\d+)/i)
  return m ? m[1] : null
}

/** A valid VDDK tarball must contain the shared library under lib64. */
export function validateVddkTarballEntries(entries: string[]): { ok: boolean; error?: string } {
  if (entries.some(e => /lib64\/libvixDiskLib\.so/i.test(e))) return { ok: true }
  return { ok: false, error: "not a VDDK tarball: no lib64/libvixDiskLib.so* entry found" }
}
