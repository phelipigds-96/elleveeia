let cookieStore = new Map()

export function setMockCookies(cookiesObj = {}) {
  cookieStore = new Map(Object.entries(cookiesObj))
}

export function clearMockCookies() {
  cookieStore = new Map()
}

export function cookies() {
  const jar = {
    get(name) {
      if (!cookieStore.has(name)) return undefined
      return { name, value: cookieStore.get(name) }
    },
    getAll() {
      return Array.from(cookieStore.entries()).map(([name, value]) => ({ name, value }))
    },
    set(name, value) {
      cookieStore.set(name, typeof value === 'object' ? value.value : String(value))
    },
    has(name) {
      return cookieStore.has(name)
    },
    delete(name) {
      cookieStore.delete(name)
    }
  }
  const p = Promise.resolve(jar)
  Object.assign(p, jar)
  return p
}

export function headers() {
  return new Headers()
}
