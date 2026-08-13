// Locale -> prompt language plumbing, shared by every AI route.
//
// AI routes talk to an LLM in free text, so the UI language cannot be
// resolved with t(): the language has to be *asked for* inside the prompt
// itself. Before this module the probe and analysis prompts were hardcoded
// in French, so an Italian customer on the English UI got French answers
// (issue #686). Every AI route now derives the language from the UI locale
// and appends an explicit instruction.

import { cookies } from 'next/headers'

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
 * UI locale of the current request, read from the NEXT_LOCALE cookie that
 * middleware always sets (see src/middleware.ts). Used by AI routes whose
 * client sends no locale in the body. Falls back to the default locale
 * when the cookie is missing or when there is no request scope at all.
 */
export async function getRequestLocale(): Promise<Locale> {
  try {
    const cookieStore = await cookies()

    return normalizeLocale(cookieStore.get('NEXT_LOCALE')?.value)
  } catch {
    return defaultLocale
  }
}
