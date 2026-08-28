// src/lib/proxmox/pbsJobSpecs.ts

import {
  optionalBoolean,
  optionalNumber,
  optionalPositiveNumber,
  pbsConfigUpdate,
  type PbsConfigUpdate,
} from "@/lib/proxmox/pbsConfigUpdate"

/**
 * Ce qui distingue les quatre jobs PBS (sync, verify, prune, tape backup) :
 * leur collection `/config/*`, leur libelle, et la traduction du corps recu de
 * l'UI vers les proprietes de PBS. Le squelette de route qui consomme ces
 * descriptions vit dans `pbsJobConfig.ts` ; ici tout est pur et testable sans
 * Next ni RBAC.
 */
export type PbsJobSpec = {
  /** Collection PBS de la configuration, par exemple `/config/verify`. */
  configPath: string
  /** Libelle des messages de reponse, par exemple `Verify job`. */
  label: string
  /** Etiquette du journal serveur, par exemple `pbs-verify-jobs`. */
  logTag: string
  /** Corps de creation. Leve [[PbsJobRequestError]] si un requis manque. */
  buildCreate: (body: any) => Record<string, unknown>
  /** Corps de modification, tableau `delete` compris. */
  buildUpdate: (body: any) => Record<string, unknown>
}

/** Corps de requete invalide : la route la traduit en 400. */
export class PbsJobRequestError extends Error {}

function requireField(value: unknown, message: string): void {
  if (!value) throw new PbsJobRequestError(message)
}

/**
 * Champs optionnels communs aux quatre creations : transmis seulement s'ils
 * sont renseignes, PBS appliquant ses propres defauts sinon.
 */
function setSharedCreateFields(params: Record<string, unknown>, body: any): void {
  if (body.ns) params.ns = body.ns
  if (body.comment) params.comment = body.comment
  if (body.maxDepth !== undefined) params["max-depth"] = Number(body.maxDepth)
}

/**
 * Champs communs aux quatre modifications, avec la meme semantique partout :
 * un vide efface (`ns` vide = namespace racine), un `undefined` ne touche a rien.
 */
function setSharedUpdateFields(update: PbsConfigUpdate, body: any): void {
  update.set("ns", body.ns)
  update.set("comment", body.comment)
  update.set("max-depth", optionalNumber(body.maxDepth))
}

/** Regles de retention d'un prune job : nom PBS, nom recu de l'UI. */
const PRUNE_KEEP_FIELDS: Array<[string, string]> = [
  ["keep-last", "keepLast"],
  ["keep-hourly", "keepHourly"],
  ["keep-daily", "keepDaily"],
  ["keep-weekly", "keepWeekly"],
  ["keep-monthly", "keepMonthly"],
  ["keep-yearly", "keepYearly"],
]

export const SYNC_JOB: PbsJobSpec = {
  configPath: "/config/sync",
  label: "Sync job",
  logTag: "pbs-sync-jobs",
  buildCreate(body) {
    requireField(body.id, "Job ID is required")
    requireField(body.store, "Datastore is required")
    requireField(body.remote, "Remote is required")
    requireField(body.remoteStore, "Remote datastore is required")

    const params: Record<string, unknown> = {
      id: body.id,
      store: body.store,
      remote: body.remote,
      "remote-store": body.remoteStore,
    }

    if (body.remoteNs) params["remote-ns"] = body.remoteNs
    if (body.schedule) params.schedule = body.schedule
    if (body.removeVanished !== undefined) {
      params["remove-vanished"] = Boolean(body.removeVanished)
    }

    setSharedCreateFields(params, body)

    return params
  },
  buildUpdate(body) {
    const update = pbsConfigUpdate()

    // `store` et `remote-store` sont obligatoires cote PBS : une valeur vide
    // se traduit par « ne pas toucher », jamais par un effacement.
    update.set("store", body.store || undefined)
    update.set("remote", body.remote || undefined)
    update.set("remote-store", body.remoteStore || undefined)
    update.set("remote-ns", body.remoteNs)
    update.set("schedule", body.schedule)
    update.set("remove-vanished", optionalBoolean(body.removeVanished))
    update.set("disable", optionalBoolean(body.disable))
    setSharedUpdateFields(update, body)

    return update.build()
  },
}

export const VERIFY_JOB: PbsJobSpec = {
  configPath: "/config/verify",
  label: "Verify job",
  logTag: "pbs-verify-jobs",
  buildCreate(body) {
    requireField(body.id, "Job ID is required")
    requireField(body.store, "Datastore is required")

    const params: Record<string, unknown> = { id: body.id, store: body.store }

    if (body.schedule) params.schedule = body.schedule
    if (body.ignoreVerified !== undefined) {
      params["ignore-verified"] = Boolean(body.ignoreVerified)
    }

    if (body.outdatedAfter) params["outdated-after"] = Number(body.outdatedAfter)

    setSharedCreateFields(params, body)

    return params
  },
  buildUpdate(body) {
    const update = pbsConfigUpdate()

    // `store` est obligatoire cote PBS : une valeur vide vaut « ne pas toucher ».
    update.set("store", body.store || undefined)
    update.set("schedule", body.schedule)
    update.set("ignore-verified", optionalBoolean(body.ignoreVerified))
    update.set("outdated-after", optionalNumber(body.outdatedAfter))
    update.set("disable", optionalBoolean(body.disable))
    setSharedUpdateFields(update, body)

    return update.build()
  },
}

export const PRUNE_JOB: PbsJobSpec = {
  configPath: "/config/prune",
  label: "Prune job",
  logTag: "pbs-prune-jobs",
  buildCreate(body) {
    requireField(body.id, "Job ID is required")
    requireField(body.store, "Datastore is required")

    // `schedule` n'est pas optionnel dans le schema d'un prune job PBS.
    requireField(body.schedule, "Schedule is required")

    const params: Record<string, unknown> = {
      id: body.id,
      store: body.store,
      schedule: body.schedule,
    }

    if (body.disable !== undefined) params.disable = Boolean(body.disable)

    for (const [pbsKey, bodyKey] of PRUNE_KEEP_FIELDS) {
      const keep = optionalPositiveNumber(body[bodyKey])

      if (keep) params[pbsKey] = keep
    }

    setSharedCreateFields(params, body)

    return params
  },
  buildUpdate(body) {
    const update = pbsConfigUpdate()

    // `store` et `schedule` sont obligatoires cote PBS : une valeur vide vaut
    // « ne pas toucher », jamais un effacement.
    update.set("store", body.store || body.datastore || undefined)
    update.set("schedule", body.schedule || undefined)
    update.set("disable", optionalBoolean(body.disable))
    setSharedUpdateFields(update, body)

    // Retention : un 0 ou un vide efface la regle via le tableau `delete`,
    // PBS refusant un `null` sur une propriete entiere.
    for (const [pbsKey, bodyKey] of PRUNE_KEEP_FIELDS) {
      update.set(pbsKey, optionalPositiveNumber(body[bodyKey]))
    }

    return update.build()
  },
}

export const TAPE_JOB: PbsJobSpec = {
  configPath: "/config/tape-backup-job",
  label: "Tape backup job",
  logTag: "pbs-tape-jobs",
  buildCreate(body) {
    requireField(body.id, "Job ID is required")
    requireField(body.store, "Datastore is required")
    requireField(body.pool, "Media Pool is required")
    requireField(body.drive, "Drive is required")

    const params: Record<string, unknown> = {
      id: body.id,
      store: body.store,
      pool: body.pool,
      drive: body.drive,
    }

    if (body.schedule) params.schedule = body.schedule
    if (body.notifyUser) params["notify-user"] = body.notifyUser
    if (body.ejectMedia) params["eject-media"] = true
    if (body.exportMediaSet) params["export-media-set"] = true
    if (body.latestOnly) params["latest-only"] = true

    setSharedCreateFields(params, body)

    return params
  },
  buildUpdate(body) {
    const update = pbsConfigUpdate()

    // `store`, `pool` et `drive` sont obligatoires cote PBS : une valeur vide
    // vaut « ne pas toucher », jamais un effacement.
    update.set("store", body.store || undefined)
    update.set("pool", body.pool || undefined)
    update.set("drive", body.drive || undefined)
    update.set("schedule", body.schedule)
    update.set("notify-user", body.notifyUser)
    update.set("eject-media", optionalBoolean(body.ejectMedia))
    update.set("export-media-set", optionalBoolean(body.exportMediaSet))
    update.set("latest-only", optionalBoolean(body.latestOnly))
    setSharedUpdateFields(update, body)

    // Un tape backup job n'a pas de propriete `disable` dans le schema PBS :
    // l'envoyer declenche « schema does not allow additional properties ».

    return update.build()
  },
}
