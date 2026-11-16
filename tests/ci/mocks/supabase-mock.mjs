let activeClient = null

export function setMockSupabaseClient(client) {
  activeClient = client
}

export function createClient() {
  if (!activeClient) {
    throw new Error('Mock Supabase client not configured via setMockSupabaseClient()')
  }
  return activeClient
}

export function createServerClient(url, key, options) {
  if (!activeClient) {
    throw new Error('Mock Supabase client not configured via setMockSupabaseClient()')
  }
  if (typeof activeClient === 'function') {
    return activeClient(url, key, options)
  }
  return activeClient
}
