export const dynamic = "force-dynamic"
import { NextResponse } from "next/server"

import { nanoid } from "nanoid"

import { prisma } from "@/lib/db/prisma"
import { hashPassword } from "@/lib/auth/password"

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
    // Vérifier s'il y a déjà des utilisateurs
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

    // Hasher le mot de passe
    const hashedPassword = await hashPassword(password)

    // Créer l'utilisateur admin + son adhésion + le grant super_admin
    // dans une seule transaction.
    const id = nanoid()
    const now = new Date()
    const normalisedEmail = email.toLowerCase().trim()

    await prisma.$transaction([
      prisma.user.create({
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
      }),
      prisma.userTenant.create({
        data: {
          userId: id,
          tenantId: "default",
          isDefault: true,
          joinedAt: now,
        },
      }),
      prisma.rbacUserRole.create({
        data: {
          id: nanoid(),
          userId: id,
          roleId: "role_super_admin",
          scopeType: "global",
          scopeTarget: null,
          tenantId: "default",
          grantedAt: now,
        },
      }),
    ])

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
    console.error("Erreur setup:", error)

    return NextResponse.json(
      { error: error?.message || "Erreur lors de la création du compte" },
      { status: 500 }
    )
  }
}

/**
 * GET /api/v1/auth/setup
 * Vérifie si le setup initial est nécessaire
 */
export async function GET() {
  try {
    const userCount = await prisma.user.count()


return NextResponse.json({
      setupRequired: userCount === 0,
      userCount,
    })
  } catch (error) {
    return NextResponse.json({
      setupRequired: true,
      userCount: 0,
    })
  }
}
