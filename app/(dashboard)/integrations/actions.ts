"use server"

import { revalidatePath } from "next/cache"
import {
  getEvolutionWhatsAppStatus,
  getEvolutionWhatsAppQrCode,
  disconnectEvolutionWhatsApp,
  restartEvolutionWhatsApp,
  type WhatsAppStatusResult,
  type WhatsAppQrCodeResult,
} from "@/lib/services/whatsapp-evolution"

export async function getWhatsAppStatusAction(): Promise<WhatsAppStatusResult> {
  return await getEvolutionWhatsAppStatus()
}

export async function getWhatsAppQrCodeAction(): Promise<WhatsAppQrCodeResult> {
  return await getEvolutionWhatsAppQrCode()
}

export async function disconnectWhatsAppAction(): Promise<{ success: boolean; error?: string }> {
  const result = await disconnectEvolutionWhatsApp()
  revalidatePath("/integrations")
  return result
}

export async function restartWhatsAppAction(): Promise<{ success: boolean; error?: string }> {
  const result = await restartEvolutionWhatsApp()
  revalidatePath("/integrations")
  return result
}
