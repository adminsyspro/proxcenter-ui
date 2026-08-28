// src/lib/proxmox/pbsConfigUpdate.ts

/**
 * Construit le corps d'un `PUT /config/*` de PBS.
 *
 * PBS verifie chaque propriete contre son schema sans jamais ignorer les
 * `null` : envoyer `{ ns: null }` pour vider un champ echoue en
 * « parameter verification failed: 'ns': Expected string value. ». Le seul
 * moyen d'effacer une propriete est de la nommer dans le tableau `delete`.
 *
 * Convention de `set()` :
 * - `undefined` : le client n'a pas transmis le champ, on n'y touche pas ;
 * - `null` ou chaine vide : le client veut l'effacer, on le met dans `delete` ;
 * - toute autre valeur (`false` et `0` compris) : on l'envoie telle quelle.
 */
export type PbsConfigUpdate = {
  set: (key: string, value: unknown) => void
  build: () => Record<string, unknown>
}

export function pbsConfigUpdate(): PbsConfigUpdate {
  const params: Record<string, unknown> = {}
  const remove: string[] = []

  return {
    set(key, value) {
      if (value === undefined) return

      if (value === null || value === "") {
        remove.push(key)

        return
      }

      params[key] = value
    },
    build() {
      return remove.length > 0 ? { ...params, delete: remove } : { ...params }
    },
  }
}

/**
 * Normalise un booleen optionnel pour `set()` : `undefined` reste
 * `undefined` (champ non transmis), tout le reste devient un vrai booleen,
 * PBS refusant un 0/1 dans un corps JSON.
 */
export function optionalBoolean(value: unknown): boolean | undefined {
  return value === undefined ? undefined : Boolean(value)
}

/**
 * Normalise un entier optionnel pour `set()` : `undefined` reste `undefined`,
 * un `null` ou une chaine vide demande l'effacement, le reste est converti.
 */
export function optionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === "") return null

  return Number(value)
}

/**
 * Variante pour les compteurs de retention : PBS n'accepte pas de `keep-*` a
 * zero, un 0 ou un negatif vaut donc « efface la regle ».
 */
export function optionalPositiveNumber(value: unknown): number | null | undefined {
  const parsed = optionalNumber(value)

  if (parsed === undefined || parsed === null) return parsed

  return parsed > 0 ? parsed : null
}
