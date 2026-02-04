export const ensurePrefix = (str, prefix) => (str.startsWith(prefix) ? str : `${prefix}${str}`)
export const withoutSuffix = (str, suffix) => (str.endsWith(suffix) ? str.slice(0, -suffix.length) : str)
export const withoutPrefix = (str, prefix) => (str.startsWith(prefix) ? str.slice(prefix.length) : str)
