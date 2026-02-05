import { NextResponse } from "next/server"

import { nanoid } from "nanoid"

import { getDb } from "@/lib/db/sqlite"
import { hashPassword } from "@/lib/auth/password"

/**
 * POST /api/v1/auth/setup
 * Crée le premier utilisateur admin (uniquement si aucun utilisateur n'existe)
 */
export async function POST(req: Request) {
  try {
    const db = getDb()

    // Vérifier s'il y a déjà des utilisateurs
    const count = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number }

    if (count.count > 0) {
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

    if (!emailRegex.test(email)) {
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

    // Créer l'utilisateur admin
    const id = nanoid()
    const now = new Date().toISOString()

    db.prepare(
      `INSERT INTO users (id, email, password, name, role, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'admin', 1, ?, ?)`
    ).run(id, email.toLowerCase().trim(), hashedPassword, name || null, now, now)

    return NextResponse.json({
      success: true,
      message: "Compte administrateur créé avec succès",
      user: {
        id,
        email: email.toLowerCase().trim(),
        name: name || null,
        role: "admin",
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
    const db = getDb()
    const count = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number }

    return NextResponse.json({
      setupRequired: count.count === 0,
      userCount: count.count,
    })
  } catch (error) {
    return NextResponse.json({
      setupRequired: true,
      userCount: 0,
    })
  }
}
