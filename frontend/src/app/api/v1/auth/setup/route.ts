export const dynamic = "force-dynamic"
import { timingSafeEqual } from "crypto"

import { NextResponse } from "next/server"

import { nanoid } from "nanoid"

import { prisma } from "@/lib/db/prisma"
import { hashPassword } from "@/lib/auth/password"
import { consumeRateLimit } from "@/lib/api-tokens/rateLimit"

/**
 * First-run bootstrap is unauthenticated by nature: there is no account to
 * authenticate against yet. What bounds it (GHSA-qxgh-pw46-6pw6):
 *
 *  - PROXCENTER_SETUP_TOKEN, when set, turns the window into a shared-secret
 *    one. Unset keeps the historical behavior, so no existing install breaks.
 *  - A global rate limit, because this endpoint can legitimately be called
 *    once in the life of an instance: nothing here needs per-IP fairness.
 *  - The "no user exists yet" test now runs INSIDE a serializable transaction
 *    with the three writes, so two concurrent calls cannot both pass it and
 *    end up with two super admins.
 */
const SETUP_ATTEMPTS_PER_MINUTE = 10
const RATE_LIMIT_KEY = "auth:setup"

/** Sentinel: the instance already has a user, thrown from inside the tx. */
const ALREADY_INITIALISED = "SETUP_ALREADY_DONE"

/**
 * Optional shared secret for the first-run window. Compared in constant time,
 * length included: a length-only mismatch must not be observable either.
 */
function setupTokenDenied(req: Request): boolean {
  const expected = process.env.PROXCENTER_SETUP_TOKEN || ""

  if (!expected) return false

  const provided = Buffer.from(req.headers.get("x-setup-token") || "", "utf8")
  const wanted = Buffer.from(expected, "utf8")

  if (provided.length !== wanted.length) return true

  return !timingSafeEqual(provided, wanted)
}

/**
 * POST /api/v1/auth/setup
 * Crée le premier utilisateur admin (uniquement si aucun utilisateur n'existe).
 *
 * Le user, l'adhésion par défaut et le grant role_super_admin sont écrits
 * dans la même transaction Prisma : aucune incohérence possible entre les
 * trois tables si l'une des écritures échoue.
 */
export async function POST(req: Request) {
  try {
    const verdict = consumeRateLimit(RATE_LIMIT_KEY, SETUP_ATTEMPTS_PER_MINUTE)

    if (!verdict.allowed) {
      return NextResponse.json(
        { error: "Trop de tentatives, réessayez dans une minute" },
        { status: 429, headers: { "Retry-After": String(verdict.retryAfter) } }
      )
    }

    if (setupTokenDenied(req)) {
      return NextResponse.json(
        { error: "Jeton d'initialisation invalide" },
        { status: 403 }
      )
    }

    // Fast path: an initialised instance answers without hashing a password
    // or opening a serializable transaction. The authoritative check is the
    // one inside the transaction below.
    const userCount = await prisma.user.count()
    if (userCount > 0) {
      return NextResponse.json(
        { error: "Le setup initial a déjà été effectué" },
        { status: 400 }
      )
    }

    const body = await req.json()
    const { email, password, name } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email et mot de passe requis" },
        { status: 400 }
      )
    }

    // Valider l'email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    if (email.length > 254 || !emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Format d'email invalide" },
        { status: 400 }
      )
    }

    // Valider le mot de passe (min 8 caractères)
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Le mot de passe doit contenir au moins 8 caractères" },
        { status: 400 }
      )
    }

    // Hasher le mot de passe (hors transaction : le hash est coûteux et n'a
    // pas à tenir un verrou sérialisable ouvert).
    const hashedPassword = await hashPassword(password)

    // Créer l'utilisateur admin + son adhésion + le grant super_admin
    // dans une seule transaction, avec le contrôle "aucun utilisateur" DEDANS.
    const id = nanoid()
    const now = new Date()
    const normalisedEmail = email.toLowerCase().trim()

    await prisma.$transaction(
      async tx => {
        if ((await tx.user.count()) > 0) throw new Error(ALREADY_INITIALISED)

        await tx.user.create({
          data: {
            id,
            email: normalisedEmail,
            password: hashedPassword,
            name: name || null,
            role: "super_admin",
            enabled: true,
            createdAt: now,
            updatedAt: now,
          },
        })
        await tx.userTenant.create({
          data: {
            userId: id,
            tenantId: "default",
            isDefault: true,
            joinedAt: now,
          },
        })
        await tx.rbacUserRole.create({
          data: {
            id: nanoid(),
            userId: id,
            roleId: "role_super_admin",
            scopeType: "global",
            scopeTarget: null,
            tenantId: "default",
            grantedAt: now,
          },
        })
      },
      { isolationLevel: "Serializable" }
    )

    return NextResponse.json({
      success: true,
      message: "Compte administrateur créé avec succès",
      user: {
        id,
        email: normalisedEmail,
        name: name || null,
        role: "super_admin",
      },
    })
  } catch (error: any) {
    // Both branches mean the same thing to the caller: someone else got there
    // first. P2034 is the serialization failure Postgres raises when two
    // concurrent bootstraps race, exactly the case this transaction exists
    // to lose safely.
    if (error?.message === ALREADY_INITIALISED || error?.code === "P2034") {
      return NextResponse.json(
        { error: "Le setup initial a déjà été effectué" },
        { status: 400 }
      )
    }

    console.error("Erreur setup:", error)

    return NextResponse.json(
      { error: error?.message || "Erreur lors de la création du compte" },
      { status: 500 }
    )
  }
}

/**
 * GET /api/v1/auth/setup
 * Vérifie si le setup initial est nécessaire.
 *
 * Ne renvoie QUE le booléen : le compte exact d'utilisateurs n'a jamais servi
 * à la page de setup et n'a pas à être lisible sans authentification.
 */
export async function GET() {
  try {
    const userCount = await prisma.user.count()

    return NextResponse.json({ setupRequired: userCount === 0 })
  } catch (error) {
    return NextResponse.json({ setupRequired: true })
  }
}
