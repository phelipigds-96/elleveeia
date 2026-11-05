import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Service Role Client para ser usado EXCLUSIVAMENTE no servidor (Server Actions, 
 * Route Handlers e rotinas administrativas em background).
 * Isso burla o RLS pelo papel privilegiado, portanto NUNCA use ou importe no navegador.
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('As variáveis de ambiente SUPABASE_URL e SERVICE_ROLE_KEY são obrigatórias.')
  }

  return createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }
  )
}
