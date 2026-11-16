"use server"

import { revalidatePath } from "next/cache"
import {
  getEvolutionWhatsAppStatus,
  getEvolutionWhatsAppQrCode,
  disconnectEvolutionWhatsApp,
  restartEvolutionWhatsApp,
  getEvolutionConfig,
  saveEvolutionConfig,
  type WhatsAppStatusResult,
  type WhatsAppQrCodeResult,
} from "@/lib/services/whatsapp-evolution"
import { assertTenantAdmin, TenantAuthError } from "@/lib/services/auth/guard"

export async function getWhatsAppStatusAction(): Promise<WhatsAppStatusResult> {
  try {
    await assertTenantAdmin()
    return await getEvolutionWhatsAppStatus()
  } catch (err: any) {
    return {
      configured: false,
      state: 'disconnected',
      error: err?.message || 'Ação restrita a administradores da empresa.',
    }
  }
}

export async function getWhatsAppQrCodeAction(): Promise<WhatsAppQrCodeResult> {
  try {
    await assertTenantAdmin()
    return await getEvolutionWhatsAppQrCode()
  } catch (err: any) {
    return {
      success: false,
      state: 'disconnected',
      error: err?.message || 'Ação restrita a administradores da empresa.',
    }
  }
}

export async function getEvolutionConfigAction(): Promise<{
  apiUrl: string
  apiKey: string
  instanceName: string
  isConfigured: boolean
  error?: string
}> {
  try {
    await assertTenantAdmin()
    const config = await getEvolutionConfig()
    return config
  } catch (err: any) {
    return {
      apiUrl: '',
      apiKey: '',
      instanceName: '',
      isConfigured: false,
      error: err?.message || 'Ação restrita a administradores da empresa.',
    }
  }
}

export async function saveEvolutionConfigAction(params: {
  apiUrl: string
  apiKey: string
  instanceName?: string
}): Promise<{ success: boolean; error?: string }> {
  try {
    await assertTenantAdmin()
    const result = await saveEvolutionConfig(params)
    revalidatePath("/integrations")
    return result
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Ação restrita a administradores e proprietários da empresa.',
    }
  }
}

export async function disconnectWhatsAppAction(): Promise<{ success: boolean; error?: string }> {
  try {
    await assertTenantAdmin()
    const result = await disconnectEvolutionWhatsApp()
    revalidatePath("/integrations")
    return result
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Ação restrita a administradores e proprietários da empresa.',
    }
  }
}

export async function restartWhatsAppAction(): Promise<{ success: boolean; error?: string }> {
  try {
    await assertTenantAdmin()
    const result = await restartEvolutionWhatsApp()
    revalidatePath("/integrations")
    return result
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Ação restrita a administradores e proprietários da empresa.',
    }
  }
}
