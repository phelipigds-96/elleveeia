import { createAdminClient } from '@/lib/supabase/service'

export interface ProcessInboundAudioParams {
  companyId: string
  eventId: string
  base64?: string
  mediaUrl?: string
  currentContent?: string
}

export interface ProcessInboundAudioResult {
  mediaUrl?: string
  transcription?: string
}

/**
 * Processa áudio recebido via webhook (Evolution API / n8n):
 * 1. Salva o áudio no bucket chat-media do Supabase Storage gerando URL pública.
 * 2. Transcreve o áudio para texto via OpenAI Whisper ou Google Gemini para o Agente de IA responder.
 */
export async function processInboundAudio(
  params: ProcessInboundAudioParams
): Promise<ProcessInboundAudioResult> {
  let mediaUrl = params.mediaUrl
  let transcription =
    params.currentContent && params.currentContent !== '[Mensagem de Voz]'
      ? params.currentContent
      : undefined

  if (!params.base64 && mediaUrl && transcription) {
    return { mediaUrl, transcription }
  }

  const cleanBase64 = params.base64
    ? params.base64.replace(/^data:audio\/[a-zA-Z0-9.-]+;base64,/, '').trim()
    : null

  if (!cleanBase64) {
    return { mediaUrl, transcription }
  }

  const buffer = Buffer.from(cleanBase64, 'base64')

  // 1. Upload do áudio para o bucket público chat-media
  try {
    const adminClient = createAdminClient()
    const safeEventId = params.eventId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const filePath = `${params.companyId}/inbound-${Date.now()}-${safeEventId.slice(-10)}.ogg`

    const { error: uploadErr } = await adminClient.storage
      .from('chat-media')
      .upload(filePath, buffer, {
        contentType: 'audio/ogg',
        upsert: true,
      })

    if (!uploadErr) {
      const { data: { publicUrl } } = adminClient.storage
        .from('chat-media')
        .getPublicUrl(filePath)
      mediaUrl = publicUrl
    } else {
      console.error('[InboundAudio] Erro ao salvar no storage:', uploadErr.message)
    }
  } catch (storageErr: any) {
    console.error('[InboundAudio] Exceção ao salvar áudio no storage:', storageErr.message)
  }

  // 2. Transcrição automática (se ainda não fornecida pelo n8n)
  if (!transcription) {
    // 2.1 Tentativa A: OpenAI Whisper
    if (process.env.OPENAI_API_KEY) {
      try {
        const formData = new FormData()
        const audioBlob = new Blob([buffer], { type: 'audio/ogg' })
        formData.append('file', audioBlob, 'audio.ogg')
        formData.append('model', 'whisper-1')
        formData.append('language', 'pt')

        const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: formData,
        })

        if (whisperRes.ok) {
          const data = await whisperRes.json()
          if (data?.text?.trim()) {
            transcription = data.text.trim()
          }
        } else {
          const errText = await whisperRes.text().catch(() => '')
          console.warn('[InboundAudio] Falha Whisper OpenAI:', whisperRes.status, errText)
        }
      } catch (whisperErr: any) {
        console.error('[InboundAudio] Erro Whisper:', whisperErr?.message || whisperErr)
      }
    }

    // 2.2 Tentativa B: Google Gemini (se Whisper não estiver disponível ou falhar)
    if (!transcription && process.env.GEMINI_API_KEY) {
      try {
        const { GoogleGenAI } = await import('@google/genai')
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

        const response = await ai.models.generateContent({
          model: 'gemini-1.5-flash',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: 'audio/ogg',
                    data: cleanBase64,
                  },
                },
                {
                  text: 'Transcreva exatamente o que foi dito neste áudio em português. Retorne EXCLUSIVAMENTE o texto transcrito, sem introduções, aspas ou comentários.',
                },
              ],
            },
          ],
        })

        if (response.text?.trim()) {
          transcription = response.text.trim()
        }
      } catch (geminiErr: any) {
        console.error('[InboundAudio] Erro Gemini Transcribe:', geminiErr?.message || geminiErr)
      }
    }
  }

  return { mediaUrl, transcription }
}
