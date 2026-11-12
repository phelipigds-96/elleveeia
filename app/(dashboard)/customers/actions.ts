'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/service'
import { requireCompanyAdmin } from '@/lib/services/auth/guard'
import { getBrazilianPhoneVariants } from '@/lib/services/phone-normalization'
import { sanitizeCustomerName } from '@/lib/services/customer-name'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface SaveCustomerInput {
  customerId?: string
  name: string
  phone?: string
  email?: string
  address?: string
  notes?: string
}

function normalizePhoneForStorage(raw?: string): { value: string | null; error?: string } {
  const digits = (raw || '').replace(/\D/g, '')
  if (!digits) {
    return { value: null }
  }
  if (digits.length < 8) {
    return { value: null, error: 'Informe um telefone válido com DDD.' }
  }
  if (digits.length === 10 || digits.length === 11) {
    return { value: `55${digits}` }
  }
  return { value: digits }
}

export async function saveCustomerAction(input: SaveCustomerInput): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const profile = await requireCompanyAdmin()
    const companyId = profile.company_id
    if (!companyId) {
      return { success: false, error: 'Empresa não identificada.' }
    }

    const cleanName = sanitizeCustomerName(input.name || '')
    if (cleanName.length < 2) {
      return { success: false, error: 'Informe um nome válido para o cliente.' }
    }

    const normalizedPhone = normalizePhoneForStorage(input.phone)
    if (normalizedPhone.error) {
      return { success: false, error: normalizedPhone.error }
    }

    const supabase = createAdminClient()
    const isUpdate = Boolean(input.customerId)

    if (isUpdate && !UUID_REGEX.test(input.customerId!)) {
      return { success: false, error: 'Cliente inválido.' }
    }

    // Impede duplicação de número dentro do mesmo tenant (com/sem 9º dígito)
    if (normalizedPhone.value) {
      const variants = getBrazilianPhoneVariants(normalizedPhone.value)
      let dupQuery = supabase
        .from('customers')
        .select('id, name')
        .eq('company_id', companyId)
        .in('phone', variants)
        .limit(1)

      if (isUpdate) {
        dupQuery = dupQuery.neq('id', input.customerId!)
      }

      const { data: duplicate } = await dupQuery.maybeSingle()
      if (duplicate) {
        return {
          success: false,
          error: `Já existe outro cliente cadastrado com esse telefone (${duplicate.name}).`,
        }
      }
    }

    const nowIso = new Date().toISOString()
    const basePayload: Record<string, any> = {
      name: cleanName,
      phone: normalizedPhone.value,
      email: input.email?.trim() || null,
      updated_at: nowIso,
    }

    const extendedPayload: Record<string, any> = {
      ...basePayload,
      address: input.address?.trim() || null,
      notes: input.notes?.trim() || null,
      name_confirmed: true,
      name_source: 'manual',
    }

    if (isUpdate) {
      const { error } = await supabase
        .from('customers')
        .update(extendedPayload)
        .eq('id', input.customerId!)
        .eq('company_id', companyId)

      if (error && error.code === '42703') {
        const { error: baseErr } = await supabase
          .from('customers')
          .update(basePayload)
          .eq('id', input.customerId!)
          .eq('company_id', companyId)

        if (baseErr) {
          return { success: false, error: `Falha ao atualizar cliente: ${baseErr.message}` }
        }
      } else if (error) {
        return { success: false, error: `Falha ao atualizar cliente: ${error.message}` }
      }
    } else {
      const { error } = await supabase.from('customers').insert({
        company_id: companyId,
        ...extendedPayload,
      })

      if (error && error.code === '42703') {
        const { error: baseErr } = await supabase.from('customers').insert({
          company_id: companyId,
          ...basePayload,
        })
        if (baseErr) {
          return { success: false, error: `Falha ao cadastrar cliente: ${baseErr.message}` }
        }
      } else if (error) {
        return { success: false, error: `Falha ao cadastrar cliente: ${error.message}` }
      }
    }

    revalidatePath('/customers')
    revalidatePath('/conversations')
    revalidatePath('/dashboard')

    return { success: true }
  } catch (err: any) {
    if (err?.digest?.startsWith?.('NEXT_REDIRECT') || err?.message === 'NEXT_REDIRECT') {
      throw err
    }
    return { success: false, error: err?.message || 'Erro inesperado ao salvar cliente.' }
  }
}

export async function deleteCustomerAction(customerId: string): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const profile = await requireCompanyAdmin()
    const companyId = profile.company_id
    if (!companyId || !UUID_REGEX.test(customerId)) {
      return { success: false, error: 'Parâmetros inválidos.' }
    }

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('customers')
      .delete()
      .eq('id', customerId)
      .eq('company_id', companyId)

    if (error) {
      return { success: false, error: `Falha ao excluir cliente: ${error.message}` }
    }

    revalidatePath('/customers')
    revalidatePath('/conversations')
    revalidatePath('/dashboard')

    return { success: true }
  } catch (err: any) {
    if (err?.digest?.startsWith?.('NEXT_REDIRECT') || err?.message === 'NEXT_REDIRECT') {
      throw err
    }
    return { success: false, error: err?.message || 'Erro ao excluir cliente.' }
  }
}
