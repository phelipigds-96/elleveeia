import { createClient } from '@supabase/supabase-js'

/**
 * Service Role Client para ser usado EXCLUSIVAMENTE em Route Handlers (APIs)
 * e rotinas do servidor em background (Webhooks). 
 * Isso burla o RLS localmente, portanto NUNCA use no navegador
 * e SEMPRE cruze informações com o `company_id` validado.
 */
export function createAdminClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('As variáveis de ambiente SUPABASE_URL e SERVICE_ROLE_KEY são obrigatórias.')
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }
  )
}
