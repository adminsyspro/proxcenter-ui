// Valeurs proposées par les Select statiques "CPU Type" de l'UI (VmDetailTabs,
// CreateVmDialog). Une valeur de config hors de cette liste (ex: modèle
// "custom-*" du cluster) rendrait le Select MUI vide — voir issue #665.
const KNOWN_VM_CPU_TYPES = new Set([
  'host', 'max', 'kvm64', 'kvm32', 'qemu64', 'qemu32',
  'x86-64-v2', 'x86-64-v2-AES', 'x86-64-v3', 'x86-64-v4',
  '486', 'pentium', 'pentium2', 'pentium3',
  'Conroe', 'Penryn', 'Nehalem', 'Nehalem-IBRS', 'Westmere', 'Westmere-IBRS',
  'SandyBridge', 'SandyBridge-IBRS', 'IvyBridge', 'IvyBridge-IBRS',
  'Haswell', 'Haswell-IBRS', 'Haswell-noTSX', 'Haswell-noTSX-IBRS',
  'Broadwell', 'Broadwell-IBRS', 'Broadwell-noTSX', 'Broadwell-noTSX-IBRS',
  'Skylake-Client', 'Skylake-Client-IBRS', 'Skylake-Client-noTSX-IBRS', 'Skylake-Client-v4',
  'Skylake-Server', 'Skylake-Server-IBRS', 'Skylake-Server-noTSX-IBRS', 'Skylake-Server-v4', 'Skylake-Server-v5',
  'Cascadelake-Server', 'Cascadelake-Server-noTSX', 'Cascadelake-Server-v2', 'Cascadelake-Server-v4', 'Cascadelake-Server-v5',
  'Cooperlake', 'Cooperlake-v2',
  'Icelake-Client', 'Icelake-Client-noTSX',
  'Icelake-Server', 'Icelake-Server-noTSX', 'Icelake-Server-v3', 'Icelake-Server-v4', 'Icelake-Server-v5', 'Icelake-Server-v6',
  'SapphireRapids', 'SapphireRapids-v2', 'GraniteRapids', 'KnightsMill',
  'athlon', 'phenom',
  'Opteron_G1', 'Opteron_G2', 'Opteron_G3', 'Opteron_G4', 'Opteron_G5',
  'EPYC', 'EPYC-IBPB', 'EPYC-v3', 'EPYC-v4',
  'EPYC-Rome', 'EPYC-Rome-v2', 'EPYC-Rome-v3', 'EPYC-Rome-v4',
  'EPYC-Milan', 'EPYC-Milan-v2', 'EPYC-Genoa',
  'coreduo', 'core2duo',
])

export function isKnownCpuType(value: string): boolean {
  return KNOWN_VM_CPU_TYPES.has(value)
}

// Extrait les modèles CPU custom d'une réponse /nodes/{node}/capabilities/qemu/cpu.
// PVE marque les modèles custom avec custom=1 ; la config VM les référence
// toujours sous la forme préfixée "custom-<nom>", normalisée ici par sécurité.
export function extractCustomCpuModels(data: unknown): string[] {
  if (!Array.isArray(data)) return []
  const models: string[] = []
  for (const raw of data) {
    const entry = raw as { name?: unknown; custom?: unknown } | null
    const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
    if (!name) continue
    const isCustom = entry?.custom === 1 || entry?.custom === true || name.startsWith('custom-')
    if (!isCustom) continue
    models.push(name.startsWith('custom-') ? name : `custom-${name}`)
  }
  return [...new Set(models)].sort((a, b) => a.localeCompare(b))
}
