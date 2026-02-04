async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, cache: 'no-store' })

  if (!res.ok) {
    const text = await res.text().catch(() => '')

    throw new Error(`API ${res.status}: ${text}`)
  }

  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>(path)
}
