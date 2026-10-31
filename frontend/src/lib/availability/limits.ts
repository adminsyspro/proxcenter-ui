// src/lib/availability/limits.ts
//
// The bounds of the availability settings, with no import so that the settings
// tab (a client component) and the server routes share one copy.

/** Same bounds as the orchestrator (availability.Min/MaxRetentionDays). */
export const RETENTION_MIN_DAYS = 30
export const RETENTION_MAX_DAYS = 1825
export const TARGET_MIN = 90
export const TARGET_MAX = 99.999
