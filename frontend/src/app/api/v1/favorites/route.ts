import { randomUUID } from 'crypto'

import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { getDb } from '@/lib/db/sqlite'
import { authOptions } from '@/lib/auth'

export const runtime = 'nodejs'

// GET /api/v1/favorites - Récupérer tous les favoris de l'utilisateur
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    const userId = session?.user?.email || 'anonymous'
    
    const db = getDb()

    const favorites = db.prepare(`
      SELECT * FROM favorites 
      WHERE user_id = ? 
      ORDER BY created_at DESC
    `).all(userId)
    
    return NextResponse.json({ 
      data: favorites,
      count: favorites.length
    })
  } catch (error: any) {
    console.error('Error fetching favorites:', error)
    
return NextResponse.json(
      { error: error?.message || 'Erreur serveur' },
      { status: 500 }
    )
  }
}

// POST /api/v1/favorites - Ajouter un favori
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    const userId = session?.user?.email || 'anonymous'
    
    const body = await req.json()
    const { connectionId, node, vmType, vmid, vmName } = body
    
    if (!connectionId || !node || !vmType || !vmid) {
      return NextResponse.json(
        { error: 'connectionId, node, vmType et vmid sont requis' },
        { status: 400 }
      )
    }
    
    // Clé unique pour la VM
    const vmKey = `${connectionId}:${node}:${vmType}:${vmid}`
    
    const db = getDb()
    
    // Vérifier si déjà en favori
    const existing = db.prepare(`
      SELECT id FROM favorites WHERE user_id = ? AND vm_key = ?
    `).get(userId, vmKey)
    
    if (existing) {
      return NextResponse.json(
        { error: 'Cette VM est déjà dans vos favoris' },
        { status: 409 }
      )
    }
    
    const id = randomUUID()
    const now = new Date().toISOString()
    
    db.prepare(`
      INSERT INTO favorites (id, user_id, vm_key, connection_id, node, vm_type, vmid, vm_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, vmKey, connectionId, node, vmType, vmid, vmName || null, now)
    
    return NextResponse.json({ 
      success: true, 
      data: { id, vmKey },
      message: 'Favori ajouté'
    })
  } catch (error: any) {
    console.error('Error adding favorite:', error)
    
return NextResponse.json(
      { error: error?.message || 'Erreur serveur' },
      { status: 500 }
    )
  }
}

// DELETE /api/v1/favorites - Supprimer un favori
export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    const userId = session?.user?.email || 'anonymous'
    
    const { searchParams } = new URL(req.url)
    const vmKey = searchParams.get('vmKey')
    
    if (!vmKey) {
      return NextResponse.json(
        { error: 'vmKey est requis' },
        { status: 400 }
      )
    }
    
    const db = getDb()
    
    const result = db.prepare(`
      DELETE FROM favorites WHERE user_id = ? AND vm_key = ?
    `).run(userId, vmKey)
    
    if (result.changes === 0) {
      return NextResponse.json(
        { error: 'Favori non trouvé' },
        { status: 404 }
      )
    }
    
    return NextResponse.json({ 
      success: true, 
      message: 'Favori supprimé'
    })
  } catch (error: any) {
    console.error('Error deleting favorite:', error)
    
return NextResponse.json(
      { error: error?.message || 'Erreur serveur' },
      { status: 500 }
    )
  }
}
