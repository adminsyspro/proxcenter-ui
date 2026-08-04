// src/middleware.ts
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { getToken } from "next-auth/jwt"

import { matchPublicApiPath } from "@/lib/api-tokens/allowlist"
import { sessionCookieName } from "@/lib/auth/cookies"
import { isPastAbsoluteCap } from "@/lib/auth/durations"

const AUTH_SECRET = process.env.NEXTAUTH_SECRET || ""

// HA VIP redirect configuration
const HA_ENABLED = process.env.HA_ENABLED === 'true'
const VIP = process.env.VIP || ''
const HA_REDIRECT_DISABLED = process.env.HA_REDIRECT_DISABLED === 'true'

// Hosts that must never be VIP-redirected: loopback, the preserved external
// URL's host (FQDN / reverse-proxy / OIDC installs keep their URL after
// conversion), plus any explicit override. Parsed ONCE at boot, like the
// flags above: the values only change with the container env.
const REDIRECT_EXEMPT_HOSTS = buildRedirectExemptHosts()

function buildRedirectExemptHosts(): Set<string> {
  const hosts = new Set(['localhost', '127.0.0.1'])

  const nextAuthUrl = process.env.NEXTAUTH_URL || ''
  if (nextAuthUrl) {
    try {
      hosts.add(new URL(nextAuthUrl).hostname.toLowerCase())
    } catch {
      // Unparseable NEXTAUTH_URL: nothing extra to exempt; the VIP
      // redirect still behaves like a fresh IP-only install.
    }
  }

  for (const entry of (process.env.HA_REDIRECT_EXEMPT_HOSTS || '').split(',')) {
    const host = entry.trim().toLowerCase()
    if (host) hosts.add(host)
  }

  return hosts
}

// i18n configuration
const locales = ['fr', 'en', 'de', 'zh-CN', 'ko', 'es']
const defaultLocale = 'en'

// Routes publiques (pas besoin d'être connecté)
const publicRoutes = [
  "/login",
  "/access", // local-login escape hatch (SSO-only mode backdoor)
  "/logout",
  "/setup",
  "/api/auth",
  "/forgot-password",
  "/reset-password",
]

// Routes that bypass the 2FA enrollment redirect entirely, even when the
// JWT carries mustEnroll2fa: true. Either the enrollment page itself, the
// routes the wizard calls, or session machinery.
const ENROLL_BYPASS = [
  "/profile/2fa/enrollment",
  "/api/v1/auth/2fa/enroll",
  "/api/v1/auth/me",
  "/api/auth",
  "/login",
  "/logout",
]

function isEnrollBypass(pathname: string): boolean {
  return ENROLL_BYPASS.some((p) => pathname === p || pathname.startsWith(p + "/"))
}

// Strips every inbound x-pxc-* header from a forwarded-request Headers
// object. These are internal signals set ONLY by this middleware (gesture 3
// below), never legitimate client input: forwarding a client-supplied
// x-pxc-entry/-path/-method would let a request forge the allowlist
// decision that getPrincipal() trusts blindly. Two call sites: the demo-mode
// branch (which bypasses the normal-mode strip entirely) and gesture 1 in
// normal mode.
function stripPxcHeaders(headers: Headers): void {
  for (const name of Array.from(headers.keys())) {
    if (name.toLowerCase().startsWith('x-pxc-')) headers.delete(name)
  }
}

// Routes API publiques
const publicApiRoutes = [
  "/api/auth",
  "/api/health",
  "/api/v1/auth/setup",
  "/api/v1/auth/providers",
  "/api/v1/app/status",
  "/api/v1/settings/branding/public", // Branding pour login page
  "/api/v1/settings/branding/uploads", // Logos/favicons pour login page
  "/api/v1/settings/login-background", // Background custom login page
  "/api/v1/settings/login-background/serve", // Serving des images background
  "/api/internal", // API internes (proxy WS, etc.)
]

// Detect locale from Accept-Language header
function getLocaleFromHeader(request: NextRequest): string {
  const acceptLanguage = request.headers.get('accept-language')

  if (!acceptLanguage) return defaultLocale

  // Parse Accept-Language header
  const browserLocales = acceptLanguage
    .split(',')
    .map(l => l.split(';')[0].trim())

  for (const bl of browserLocales) {
    // Try exact match first (e.g. zh-CN)
    const exact = locales.find(loc => loc.toLowerCase() === bl.toLowerCase())

    if (exact) return exact

    // Fallback to 2-letter prefix match (e.g. fr-FR -> fr)
    const prefix = bl.substring(0, 2).toLowerCase()
    const prefixMatch = locales.find(loc => loc.toLowerCase() === prefix)

    if (prefixMatch) return prefixMatch
  }

  return defaultLocale
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

      // For non-v1 API routes, pass through with demo header. This branch
      // returns before the normal-mode strip below ever runs, and a demo
      // build has real route handlers behind it (the /api/v1/public/*
      // routes this task adds) — so the resolver must not be the only
      // thing standing between a forged x-pxc-* header and a handler.
      const requestHeaders = new Headers(request.headers)
      stripPxcHeaders(requestHeaders)
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

  // === HA VIP REDIRECT ===
  // Loop guard: the VIP host itself and every exempt host pass through, so
  // a redirected request can never be redirected again (Ch2 regression I1).
  if (HA_ENABLED && !HA_REDIRECT_DISABLED && VIP) {
    const rawHost = request.headers.get('host') || ''
    const host = rawHost.replace(/:\d+$/, '').toLowerCase()

    if (host !== VIP && !REDIRECT_EXEMPT_HOSTS.has(host)) {
      const isExemptPath = pathname === '/api/health'
        || pathname.startsWith('/api/health/')
        || pathname.startsWith('/api/v1/ha/')
      if (!isExemptPath) {
        const search = request.nextUrl.search || ''
        return NextResponse.redirect(`http://${VIP}:3000${pathname}${search}`, 302)
      }
    }
  }

  // === NORMAL MODE (existing behavior) ===

  const isApiPath = pathname.startsWith('/api/')

  // API tokens, gesture 1 (spec section 6): strip EVERY inbound x-pxc-*
  // header, FIRST instruction of the normal-mode API path, before the storage
  // upload bypass below. Absolute rule: no NextResponse.next() on any /api/*
  // path is ever emitted with unsanitized client headers. Trusted values are
  // re-set below only by the bounded derogation.
  const requestHeaders = new Headers(request.headers)
  if (isApiPath) {
    stripPxcHeaders(requestHeaders)
  }

  // Gesture 2 (existing bypass, unchanged semantics, now AFTER the strip):
  // skip middleware for large upload routes (auth handled in route handler
  // via checkPermission)
  if (pathname.includes('/storage/') && pathname.endsWith('/upload')) {
    return NextResponse.next({ request: { headers: requestHeaders } })
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
      secret: AUTH_SECRET,
      cookieName: sessionCookieName()
    })

    // Si pas de token, rediriger vers login
    if (!token) {
      const loginUrl = new URL("/login", request.url)

      loginUrl.searchParams.set("callbackUrl", pathname)

      return NextResponse.redirect(loginUrl)
    }

    // Absolute cap, checked here so it also holds for page navigation. getToken
    // only decodes the JWT (jwt/index.js:118) — no callbacks, so the read-path
    // validation never runs for the middleware. authAt makes the one deadline
    // that matters against a stolen cookie enforceable with pure arithmetic,
    // keeping this file Prisma-free and Edge-valid. isPastAbsoluteCap is the
    // same predicate lib/auth/sessions.ts:evaluateSession uses for the DB-backed
    // row's createdAt, so the two never drift into separately-worded copies of
    // one rule.
    //
    // A token without authAt is left alone: the read path refuses it anyway,
    // and redirecting here as well risks a loop. This code only runs past the
    // isPublicRoute early-return above, so /login itself can never be
    // redirected by this check.
    if (token.authAt && isPastAbsoluteCap(Number(token.authAt))) {
      const url = request.nextUrl.clone()

      url.pathname = "/login"
      url.search = ""

      return NextResponse.redirect(url)
    }

    if (token.mustEnroll2fa && !isEnrollBypass(pathname)) {
      return NextResponse.redirect(new URL("/profile/2fa/enrollment", request.url))
    }

    return response
  }

  // Gesture 3: bounded API-token derogation, placed BEFORE the early return
  // below on purpose: isAsset includes pathname.includes('.') and an
  // allowlisted path containing a dot would otherwise skip this gate. The
  // middleware never validates the token (edge runtime, no DB): it only
  // matches the path via the shared matcher and stamps the internal headers;
  // hash, license, tenant, scopes and quota live in getPrincipal().
  const hasApiTokenBearer =
    isApiPath && (request.headers.get('authorization') || '').startsWith('Bearer pxc_')
  if (isApiPath) {
    const matched = matchPublicApiPath(pathname)
    if (matched.ok) {
      // Server-to-server only (spec section 8): explicit 405 to any OPTIONS
      // on the exposed surface, answered by the middleware itself.
      if (request.method === 'OPTIONS') {
        return NextResponse.json(
          { error: 'API tokens are read-only', method: 'OPTIONS' },
          { status: 405, headers: { Allow: 'GET, HEAD' } },
        )
      }
      if (hasApiTokenBearer) {
        // Precedent for request-header injection in this file: demo mode
        // (lines 153-158). Neither the cookie 401 nor the 2FA enrollment
        // gate applies to this branch.
        requestHeaders.set('x-pxc-method', request.method)
        requestHeaders.set('x-pxc-path', pathname)
        requestHeaders.set('x-pxc-entry', matched.entryId as string)
        return NextResponse.next({ request: { headers: requestHeaders } })
      }
    }
  }

  // A Bearer pxc_ outside the allowlist derogates to NOTHING: it must not
  // even ride the isAsset dot rescue (pathname.includes('.')) below, it falls
  // through to the existing JWT check and its cookie 401 instead. Cookie
  // browser requests never carry a Bearer pxc_, so their behavior here is
  // strictly unchanged.
  if (isPublicRoute || isPublicApiRoute || (isAsset && !hasApiTokenBearer)) {
    return NextResponse.next(isApiPath ? { request: { headers: requestHeaders } } : undefined)
  }

  // Vérifier le token JWT pour les API
  const token = await getToken({
    req: request,
    secret: AUTH_SECRET,
    cookieName: sessionCookieName()
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

  if (token.mustEnroll2fa && !isEnrollBypass(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "ENROLLMENT_REQUIRED", redirect: "/profile/2fa/enrollment" },
        { status: 403 }
      )
    }
    return NextResponse.redirect(new URL("/profile/2fa/enrollment", request.url))
  }

  // Utilisateur authentifié, continuer (sanitized headers on API paths)
  return NextResponse.next(isApiPath ? { request: { headers: requestHeaders } } : undefined)
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
