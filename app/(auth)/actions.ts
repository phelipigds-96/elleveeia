'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/service'

export async function login(formData: FormData) {
  const supabase = createClient()
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: 'E-mail ou senha incorretos. Tente novamente.' }
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signup(formData: FormData) {
  const supabase = createClient()
  const fullName = formData.get('fullName') as string
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const confirmPassword = formData.get('confirmPassword') as string

  if (password !== confirmPassword) {
    return { error: 'As senhas não coincidem.' }
  }

  const { data, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
    }
  })

  if (signUpError) {
    return { error: signUpError.message }
  }

  // Provisionar a empresa contornando a falta de permissões caso a sessão não inicie
  if (data.user) {
    const adminClient = createAdminClient()
    const firstName = fullName.split(' ')[0]
    const companyName = `Empresa de ${firstName}`
    const slug = `${companyName.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}`

    const { data: company, error: companyError } = await adminClient
      .from('companies')
      .insert({ name: companyName, slug })
      .select()
      .single()

    if (companyError || !company) {
      console.error('Falha ao criar company:', companyError)
      return { error: 'Conta criada, mas falha ao provisionar empresa. Contate o suporte.' }
    }

    const { error: profileError } = await adminClient
      .from('profiles')
      .insert({
        id: data.user.id,
        company_id: company.id,
        full_name: fullName,
        email: email,
        role: 'admin'
      })

    if (profileError) {
      console.error('Falha ao criar profile:', profileError)
      return { error: 'Conta criada, mas falha ao provisionar perfil. Contate o suporte.' }
    }
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function logout() {
  const supabase = createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
