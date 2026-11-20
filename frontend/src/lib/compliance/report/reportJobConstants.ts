// Shared by the server store of background reports and the browser, which
// stops offering a report once the server has dropped it.

/** A finished report is kept this long for its download. */
export const REPORT_JOB_TTL_MS = 30 * 60_000
