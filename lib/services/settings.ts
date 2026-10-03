'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateCompany(name: string) {
  try {
    const supabase = createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Não autenticado' }

    // Verifica se o usuário tem permissão de admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id, role')
      .eq('id', user.id)
      .single()

    if (!profile || !profile.company_id) {
      return { error: 'Empresa não encontrada' }
    }

    if (profile.role !== 'admin' && profile.role !== 'owner') {
      return { error: 'Você não tem permissão para editar a empresa' }
    }

    if (!name.trim()) {
      return { error: 'O nome da empresa não pode ser vazio' }
    }

    const { error: updateError } = await supabase
      .from('companies')
      .update({ name: name.trim() })
      .eq('id', profile.company_id)

    if (updateError) {
      return { error: `Erro ao atualizar empresa: ${updateError.message}` }
    }

    revalidatePath('/settings')
    return { success: true }
  } catch (err: any) {
    return { error: `Erro interno: ${err.message}` }
  }
}
