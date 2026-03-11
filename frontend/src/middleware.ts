// src/middleware.ts
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { getToken } from "next-auth/jwt"

const AUTH_SECRET = process.env.NEXTAUTH_SECRET || "your-secret-key-change-in-production"

// i18n configuration
const locales = ['fr', 'en']
const defaultLocale = 'en'

// Routes publiques (pas besoin d'être connecté)
const publicRoutes = [
  "/login",
  "/logout",
  "/setup",
  "/api/auth",
  "/forgot-password",
  "/reset-password",
]

// Routes API publiques
const publicApiRoutes = [
  "/api/auth",
  "/api/health",
  "/api/v1/auth/setup",
  "/api/v1/auth/providers",
  "/api/v1/app/status",
  "/api/v1/settings/branding/public", // Branding pour login page
  "/api/internal", // API internes (proxy WS, etc.)
]

// Detect locale from Accept-Language header
function getLocaleFromHeader(request: NextRequest): string {
  const acceptLanguage = request.headers.get('accept-language')

  if (!acceptLanguage) return defaultLocale

  // Parse Accept-Language and find first matching locale
  const browserLocales = acceptLanguage
    .split(',')
    .map(l => l.split(';')[0].trim().substring(0, 2).toLowerCase())

  const matchedLocale = browserLocales.find(l => locales.includes(l))

  return matchedLocale || defaultLocale
}

// Get locale from cookie or header
function getLocale(request: NextRequest): string {
  // Check cookie first
  const localeCookie = request.cookies.get('NEXT_LOCALE')?.value

  if (localeCookie && locales.includes(localeCookie)) {
    return localeCookie
  }

  // Fallback to Accept-Language header
  return getLocaleFromHeader(request)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isDemoMode = process.env.DEMO_MODE === 'true'

  // === DEMO MODE: bypass auth, mock API routes ===
  if (isDemoMode) {
    const { demoResponse } = await import("@/lib/demo/demo-api")
    // /login and /setup always redirect to /home in demo mode
    if (pathname === '/login' || pathname.startsWith('/login') || pathname === '/setup' || pathname.startsWith('/setup')) {
      return NextResponse.redirect(new URL('/home', request.url))
    }

    // API routes: intercept with mock responses (bypass all route handlers)
    if (pathname.startsWith('/api/')) {
      // Mock NextAuth session endpoint (used by useSession() client-side)
      if (pathname === '/api/auth/session') {
        return NextResponse.json({
          user: { id: 'demo-user', name: 'Admin Demo', email: 'admin@demo.proxcenter.io', role: 'super_admin', image: null },
          expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        })
      }

      // For /api/v1/* routes, return mock data directly from the interceptor
      const mockResponse = demoResponse(request)
      if (mockResponse) return mockResponse

      // For non-v1 API routes, pass through with demo header
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('x-demo-mode', 'true')

      return NextResponse.next({
        request: { headers: requestHeaders },
      })
    }

    // Page routes: skip all auth checks, just handle locale
    if (!pathname.startsWith('/api/') && !pathname.startsWith('/_next') && !pathname.startsWith('/images') && !pathname.startsWith('/favicon') && !pathname.includes('.')) {
      const locale = getLocale(request)
      const response = NextResponse.next()

      if (!request.cookies.get('NEXT_LOCALE')) {
        response.cookies.set('NEXT_LOCALE', locale, {
          path: '/',
          maxAge: 60 * 60 * 24 * 365,
          sameSite: 'lax'
        })
      }

      return response
    }

    // Static assets etc. — pass through
    return NextResponse.next()
  }

  // === NORMAL MODE (existing behavior) ===

  // Skip middleware for large upload routes (auth handled in route handler via checkPermission)
  if (pathname.includes('/storage/') && pathname.endsWith('/upload')) {
    return NextResponse.next()
  }

  // Vérifier si c'est une route publique
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route))
  const isPublicApiRoute = publicApiRoutes.some(route => pathname.startsWith(route))

  // Assets et fichiers statiques
  const isAsset = pathname.startsWith("/_next") ||
                  pathname.startsWith("/images") ||
                  pathname.startsWith("/favicon") ||
                  pathname.includes(".")

  // Handle locale detection for non-API routes
  if (!pathname.startsWith("/api/") && !isAsset) {
    const locale = getLocale(request)
    const response = NextResponse.next()

    // Set locale cookie if not present
    if (!request.cookies.get('NEXT_LOCALE')) {
      response.cookies.set('NEXT_LOCALE', locale, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365, // 1 year
        sameSite: 'lax'
      })
    }

    // Continue to auth check below, but with the response that has the cookie
    if (isPublicRoute) {
      return response
    }

    // Vérifier le token JWT
    const token = await getToken({
      req: request,
      secret: AUTH_SECRET
    })

    // Si pas de token, rediriger vers login
    if (!token) {
      const loginUrl = new URL("/login", request.url)

      loginUrl.searchParams.set("callbackUrl", pathname)

      return NextResponse.redirect(loginUrl)
    }

    return response
  }

  if (isPublicRoute || isPublicApiRoute || isAsset) {
    return NextResponse.next()
  }

  // Vérifier le token JWT pour les API
  const token = await getToken({
    req: request,
    secret: AUTH_SECRET
  })

  // Si pas de token, retourner 401 pour les API
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      )
    }

    const loginUrl = new URL("/login", request.url)

    loginUrl.searchParams.set("callbackUrl", pathname)

    return NextResponse.redirect(loginUrl)
  }

  // Utilisateur authentifié, continuer
  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|images/).*)",
  ],
}
