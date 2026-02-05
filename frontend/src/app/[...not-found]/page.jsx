import { notFound } from 'next/navigation'

// Cette page catch-all redirige vers le not-found.jsx racine
export default function CatchAllNotFound() {
  notFound()
}
