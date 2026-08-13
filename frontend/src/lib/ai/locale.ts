// Locale -> prompt language plumbing, shared by every AI route.
//
// AI routes talk to an LLM in free text, so the UI language cannot be
// resolved with t(): the language has to be *asked for* inside the prompt
// itself. Before this module the probe and analysis prompts were hardcoded
// in French, so an Italian customer on the English UI got French answers
// (issue #686). Every AI route now derives the language from the UI locale
// and appends an explicit instruction.

import { cookies, headers } from 'next/headers'

import { defaultLocale, locales, type Locale } from '@/i18n/config'

// English name of the language we ask the model to answer in, per UI locale.
// English names on purpose: models follow "answer in Simplified Chinese"
// more reliably than a native-script label.
const languageNames: Record<Locale, string> = {
  fr: 'French',
  en: 'English',
  de: 'German',
  'zh-CN': 'Simplified Chinese',
  ko: 'Korean',
  es: 'Spanish',
}

/**
 * Narrow an arbitrary string (cookie value, request body field) to a
 * supported locale, falling back to the default locale. Callers may pass
 * anything: the NEXT_LOCALE cookie is user-writable and an unsupported UI
 * language (e.g. `it`) must degrade to English, never crash.
 */
export function normalizeLocale(locale?: string | null): Locale {
  if (locale && (locales as readonly string[]).includes(locale)) return locale as Locale

  return defaultLocale
}

/** English name of the language matching a UI locale ("de" -> "German"). */
export function localeToLanguageName(locale?: string | null): string {
  return languageNames[normalizeLocale(locale)]
}

/**
 * Instruction to append to a free-text prompt so the answer comes back in
 * the user's language. The "overrides any other language" clause matters:
 * several prompts are still authored in French or English, and without it
 * the model tends to mirror the prompt language instead.
 */
export function languageInstruction(locale?: string | null): string {
  return `LANGUAGE: your entire answer MUST be written in ${localeToLanguageName(locale)}. This overrides any other language mentioned in this prompt.`
}

/**
 * Same, for prompts whose reply is machine-parsed as JSON. Only the
 * human-readable values may be translated; translating the keys would
 * break every consumer that reads `summary` / `recommendations`.
 */
export function jsonLanguageInstruction(locale?: string | null): string {
  return `LANGUAGE: keep every JSON key exactly as specified above (in English), but write every human-readable string value in ${localeToLanguageName(locale)}. This overrides any other language mentioned in this prompt.`
}

/**
 * First locale of an Accept-Language header that ProxCenter ships, exact
 * match first then two-letter prefix ("fr-FR" -> "fr"). Mirrors the
 * resolution order of src/i18n/request.ts, which is what actually decides
 * the language of the UI the answer will be displayed in.
 */
function localeFromAcceptLanguage(header: string | null): Locale | undefined {
  if (!header) return undefined

  for (const entry of header.split(',').map(part => part.split(';')[0].trim())) {
    const exact = locales.find(loc => loc.toLowerCase() === entry.toLowerCase())

    if (exact) return exact

    const prefix = entry.slice(0, 2).toLowerCase()
    const prefixMatch = locales.find(loc => loc.toLowerCase() === prefix)

    if (prefixMatch) return prefixMatch
  }

  return undefined
}

/**
 * UI locale of the current request, for AI routes whose client sends no
 * locale in its body. Resolved exactly like src/i18n/request.ts does for
 * the UI itself: NEXT_LOCALE cookie first, then Accept-Language.
 *
 * The header fallback is not decoration. Middleware only sets the cookie on
 * page requests, so a browser that blocks it, or a client that reaches an
 * API route without ever loading a page, renders a German UI from
 * Accept-Language while a cookie-only resolver would answer in English:
 * the very symptom #686 is about. Falls back to the default locale when
 * there is no request scope at all.
 */
export async function getRequestLocale(): Promise<Locale> {
  try {
    const cookieStore = await cookies()
    const fromCookie = cookieStore.get('NEXT_LOCALE')?.value

    if (fromCookie && (locales as readonly string[]).includes(fromCookie)) {
      return fromCookie as Locale
    }

    const headerStore = await headers()

    return localeFromAcceptLanguage(headerStore.get('accept-language')) ?? defaultLocale
  } catch {
    return defaultLocale
  }
}
