// Turn a raw user-agent string into a browser + OS pair for display.
//
// Deliberately a small heuristic and not ua-parser-js: this is a display
// label, a wrong guess on an exotic browser costs nothing, and a dependency
// costs maintenance forever. Unknown input yields nulls so the caller can
// render a translated "Unknown" rather than an empty cell, and the raw string
// stays available in a tooltip.
//
// Order matters in both tables: Edge and Opera also carry a Chrome token, and
// Chrome also carries a Safari token.

const BROWSERS: Array<[RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//i, "Edge"],
  [/\bOPR\/|\bOpera\//i, "Opera"],
  [/\bChrome\/|\bCriOS\//i, "Chrome"],
  [/\bFirefox\/|\bFxiOS\//i, "Firefox"],
  [/\bSafari\//i, "Safari"],
]

const PLATFORMS: Array<[RegExp, string]> = [
  [/\bAndroid\b/i, "Android"],
  [/\biPhone\b|\biPad\b|\biPod\b|\biOS\b/i, "iOS"],
  [/\bWindows NT\b|\bWindows\b/i, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/i, "macOS"],
  [/\bLinux\b|\bX11\b/i, "Linux"],
]

function firstMatch(ua: string, table: Array<[RegExp, string]>): string | null {
  for (const [re, label] of table) {
    if (re.test(ua)) return label
  }
  return null
}

export function deviceLabel(userAgent: string | null | undefined): {
  browser: string | null
  os: string | null
} {
  if (!userAgent) return { browser: null, os: null }
  return {
    browser: firstMatch(userAgent, BROWSERS),
    os: firstMatch(userAgent, PLATFORMS),
  }
}
