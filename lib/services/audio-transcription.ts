import { createAdminClient } from '@/lib/supabase/service'

export interface ProcessInboundMediaParams {
  companyId: string
  eventId: string
  mediaType?: 'audio' | 'image' | 'document' | string
  base64?: string
  mediaUrl?: string
  currentContent?: string
}

export interface ProcessInboundMediaResult {
  mediaUrl?: string
  transcription?: string
  mediaType?: string
}

/**
 * Processa qualquer mídia recebida via webhook (Evolution API / n8n):
 * 1. Imagem: Salva no Supabase Storage (`chat-media`) e gera URL pública.
 * 2. Áudio: Salva no Storage e transcreve para texto via OpenAI Whisper / Google Gemini.
 * 3. Documento: Salva no Storage gerando link de download.
 */
export async function processInboundMedia(
  params: ProcessInboundMediaParams
): Promise<ProcessInboundMediaResult> {
  let mediaUrl = params.mediaUrl
  let mediaType = params.mediaType || 'audio'
  let transcription =
    params.currentContent &&
    params.currentContent !== '[Mensagem de Voz]' &&
    params.currentContent !== '[Imagem]'
      ? params.currentContent
      : undefined

  if (!params.base64 && mediaUrl) {
    return { mediaUrl, transcription, mediaType }
  }

  const cleanBase64 = params.base64
    ? params.base64.replace(/^data:(image|audio|application)\/[a-zA-Z0-9.-]+;base64,/, '').trim()
    : null

  if (!cleanBase64) {
    return { mediaUrl, transcription, mediaType }
  }

  const buffer = Buffer.from(cleanBase64, 'base64')
  const safeEventId = params.eventId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const adminClient = createAdminClient()

  // 1. Determina extensão e tipo MIME
  let contentType = 'audio/ogg'
  let fileExt = 'ogg'

  if (mediaType === 'image' || mediaType === 'imageMessage') {
    contentType = 'image/jpeg'
    fileExt = 'jpg'
    mediaType = 'image'
  } else if (mediaType === 'document' || mediaType === 'documentMessage') {
    contentType = 'application/pdf'
    fileExt = 'pdf'
    mediaType = 'document'
  } else {
    mediaType = 'audio'
  }

  // 2. Upload para o bucket público chat-media
  try {
    const filePath = `${params.companyId}/inbound-${Date.now()}-${safeEventId.slice(-10)}.${fileExt}`

    const { error: uploadErr } = await adminClient.storage
      .from('chat-media')
      .upload(filePath, buffer, {
        contentType,
        upsert: true,
      })

    if (!uploadErr) {
      const { data: { publicUrl } } = adminClient.storage
        .from('chat-media')
        .getPublicUrl(filePath)
      mediaUrl = publicUrl
    } else {
      console.error('[InboundMedia] Erro ao salvar no storage:', uploadErr.message)
    }
  } catch (storageErr: any) {
    console.error('[InboundMedia] Exceção ao salvar mídia no storage:', storageErr.message)
  }

  // 3. Se for Imagem e não houver legenda, define placeholder
  if (mediaType === 'image') {
    if (!transcription || transcription.trim() === '') {
      transcription = '[Imagem]'
    }
    return { mediaUrl, transcription, mediaType }
  }

  // 4. Se for Documento e não houver legenda, define placeholder
  if (mediaType === 'document') {
    if (!transcription || transcription.trim() === '') {
      transcription = '[Documento]'
    }
    return { mediaUrl, transcription, mediaType }
  }

  // 5. Se for Áudio e ainda não há transcrição, transcrever via OpenAI Whisper
  if (mediaType === 'audio' && !transcription) {
    // 5.1 Tentativa A: OpenAI Whisper
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
          console.warn('[InboundMedia] Falha Whisper OpenAI:', whisperRes.status, errText)
        }
      } catch (whisperErr: any) {
        console.error('[InboundMedia] Erro Whisper:', whisperErr?.message || whisperErr)
      }
    }

    // 5.2 Tentativa B: Google Gemini
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
        console.error('[InboundMedia] Erro Gemini Transcribe:', geminiErr?.message || geminiErr)
      }
    }

    if (!transcription || transcription.trim() === '') {
      transcription = '[Mensagem de Voz]'
    }
  }

  return { mediaUrl, transcription, mediaType }
}

// Compatibilidade reversa com o import anterior
export const processInboundAudio = processInboundMedia
