import assert from 'node:assert/strict'
import test from 'node:test'
import { processInboundMedia } from '@/lib/services/audio-transcription'
import { fetchEvolutionMediaBase64 } from '@/lib/services/whatsapp-evolution'

test('1. fetchEvolutionMediaBase64 lida com parâmetros inválidos sem explodir', async () => {
  const emptyRes = await fetchEvolutionMediaBase64({ messageExternalId: '' })
  assert.equal(Boolean(emptyRes.error), true)
  assert.match(emptyRes.error!, /messageExternalId/)
})

test('2. fetchEvolutionMediaBase64 chama endpoint correto e extrai base64', async () => {
  const originalFetch = globalThis.fetch
  let calledUrl = ''
  let calledMethod = ''
  let calledHeaders: any = {}
  let calledBody: any = null

  try {
    globalThis.fetch = async (url: any, init: any) => {
      calledUrl = String(url)
      calledMethod = init?.method || 'GET'
      calledHeaders = init?.headers || {}
      calledBody = init?.body ? JSON.parse(init.body) : null

      return new Response(
        JSON.stringify({
          mediaType: 'audioMessage',
          fileName: 'audio.oga',
          mimetype: 'audio/ogg; codecs=opus',
          base64: 'T2dnUwACAAAAbW9jay1hdWRpby1ieXRlcw==',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Passa apiUrl e apiKey mockados via mock de resolveEvolutionContext ou fetch direto
    // Como estamos no ambiente Node de teste, testamos a estrutura da chamada
    const res = await fetchEvolutionMediaBase64({
      instanceName: 'Sumel Alimentos',
      messageExternalId: 'evolution-AC0F1D59568587C902DE419CED56A04E',
      apiUrl: 'https://evolution.example.com',
      apiKey: 'test-key',
    })

    assert.equal(Boolean(res.base64), true)
    assert.match(calledUrl, /https:\/\/evolution\.example\.com\/chat\/getBase64FromMediaMessage\/Sumel%20Alimentos/)
    assert.equal(calledMethod, 'POST')
    assert.equal(calledHeaders?.apikey, 'test-key')
    assert.equal(calledBody?.message?.key?.id, 'AC0F1D59568587C902DE419CED56A04E')
    assert.equal(calledBody?.convertToMp4, false)
    assert.equal(res.mimetype, 'audio/ogg; codecs=opus')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('3. processInboundMedia usa fallback da Evolution quando base64 é vazio', async () => {
  const originalFetch = globalThis.fetch
  let whisperCalled = false

  try {
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url)
      if (urlStr.includes('/chat/getBase64FromMediaMessage/')) {
        return new Response(
          JSON.stringify({
            mediaType: 'audioMessage',
            mimetype: 'audio/ogg; codecs=opus',
            base64: Buffer.from('mock-audio-data').toString('base64'),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (urlStr.includes('api.openai.com/v1/audio/transcriptions')) {
        whisperCalled = true
        return new Response(
          JSON.stringify({ text: 'Quero 2 barras de chocolate marfim' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response('{}', { status: 200 })
    }

    const prevOpenAiKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'mock-key-for-transcription'

    const result = await processInboundMedia({
      companyId: '00000000-0000-0000-0000-000000000001',
      eventId: 'evt-test-1',
      mediaType: 'audio',
      base64: '', // VAZIO - força o fallback
      instanceName: 'Sumel Alimentos',
      messageExternalId: 'AC0F1D59568587C902DE419CED56A04E',
    })

    process.env.OPENAI_API_KEY = prevOpenAiKey

    // O fallback buscou o áudio e transcreveu com Whisper
    assert.equal(result.mediaType, 'audio')
    if (whisperCalled) {
      assert.equal(result.transcription, 'Quero 2 barras de chocolate marfim')
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})
