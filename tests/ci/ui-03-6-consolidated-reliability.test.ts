import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import {
  isStaleConversationLoad,
  mergeRealtimeInsertedMessage,
  reconcileOptimisticMessage,
  releaseAudioRecorderResources,
  resolveComposerSubmitIntent,
  validateAttachmentFile,
} from "../../lib/ui/conversations-composer"
import {
  applyConfirmedCustomerUpdate,
  isStaleCustomerProfileLoad,
  mergeLoadedCustomerDetails,
} from "../../lib/ui/conversations-inspector"
import {
  buildMessageFeedEntries,
  classifyMessageAuthor,
} from "../../lib/ui/conversations-messages"
import { parseCommercialQuoteText } from "../../lib/ui/conversations-quote-card"
import {
  FEED_PIN_TO_BOTTOM_THRESHOLD_PX,
  isFeedNearBottom,
} from "../../lib/ui/conversations-viewport"
import type { ConversationData, MessageData } from "../../app/(dashboard)/conversations/actions"

function makeMessage(overrides: Partial<MessageData> & { id: string }): MessageData {
  return {
    conversation_id: "conv-a",
    sender_type: "human",
    message_type: "text",
    content: "Mensagem teste",
    created_at: "2026-11-26T15:00:00.000Z",
    metadata: {},
    ...overrides,
  }
}

test("UI-03.6 Confiabilidade 1 (Determinístico): Trocas rápidas A → B → A descartam respostas fora de ordem no histórico e no perfil", () => {
  // Histórico: resposta antiga de A (seq=1) chega após A → B (seq=2) → A (seq=3)
  assert.equal(
    isStaleConversationLoad({
      activeConversationId: "conv-a",
      requestConversationId: "conv-a",
      activeSeq: 3,
      requestSeq: 1,
    }),
    true
  )
  // Histórico: resposta atrasada de B (seq=2) chega quando usuário voltou para A (seq=3)
  assert.equal(
    isStaleConversationLoad({
      activeConversationId: "conv-a",
      requestConversationId: "conv-b",
      activeSeq: 3,
      requestSeq: 2,
    }),
    true
  )
  // Apenas a carga vigente de A (seq=3) é aceita
  assert.equal(
    isStaleConversationLoad({
      activeConversationId: "conv-a",
      requestConversationId: "conv-a",
      activeSeq: 3,
      requestSeq: 3,
    }),
    false
  )

  // Perfil do Inspector: mesma proteção A → B → A
  assert.equal(
    isStaleCustomerProfileLoad({
      activeConversationId: "conv-a",
      requestConversationId: "conv-a",
      activeCustomerId: "cust-a",
      requestCustomerId: "cust-a",
      activeSeq: 3,
      requestSeq: 1,
    }),
    true
  )
  assert.equal(
    isStaleCustomerProfileLoad({
      activeConversationId: "conv-a",
      requestConversationId: "conv-a",
      activeCustomerId: "cust-a",
      requestCustomerId: "cust-a",
      activeSeq: 3,
      requestSeq: 3,
    }),
    false
  )
})

test("UI-03.6 Confiabilidade 2 (Determinístico): Timeout de envio + confirmação tardia + chegada Realtime nunca duplicam mensagem", () => {
  const clientMsgId = "cmsg-ui036-timeout-1"
  const optimistic = makeMessage({
    id: "temp-1001",
    content: "Confirmação tardia pós-timeout",
    metadata: { client_message_id: clientMsgId, delivery_status: "pending" },
  })
  const realtimeDelivered = makeMessage({
    id: "db-msg-9001",
    content: "Confirmação tardia pós-timeout",
    metadata: { client_message_id: clientMsgId, delivery_status: "sent" },
  })

  // Ordem A: Realtime chega antes da confirmação tardia da Server Action
  const afterRealtimeFirst = mergeRealtimeInsertedMessage([optimistic], realtimeDelivered)
  assert.equal(afterRealtimeFirst.length, 1)
  assert.equal(afterRealtimeFirst[0].id, "db-msg-9001")

  const afterLateServerConfirm = reconcileOptimisticMessage(
    afterRealtimeFirst,
    "temp-1001",
    "db-msg-9001",
    { delivery_status: "delivered" }
  )
  assert.equal(afterLateServerConfirm.length, 1)
  assert.equal(afterLateServerConfirm[0].id, "db-msg-9001")
  assert.equal(afterLateServerConfirm[0].metadata?.delivery_status, "delivered")

  // Ordem B: Confirmação da Server Action chega antes do evento Realtime
  const afterServerFirst = reconcileOptimisticMessage([optimistic], "temp-1001", "db-msg-9001", {
    delivery_status: "sent",
  })
  const afterLateRealtime = mergeRealtimeInsertedMessage(afterServerFirst, realtimeDelivered)
  assert.equal(afterLateRealtime.length, 1)
  assert.equal(afterLateRealtime[0].id, "db-msg-9001")

  // Deduplicação defensiva no feed final
  const feed = buildMessageFeedEntries([realtimeDelivered, realtimeDelivered])
  const renderedMessages = feed.filter((e) => e.kind === "message")
  assert.equal(renderedMessages.length, 1)
})

test("UI-03.6 Confiabilidade 3 (Determinístico): Edição concorrente de perfil preserva campos dirty e isola contatos", () => {
  const draft = {
    id: "cust-a",
    name: "Nome Salvo pelo Operador",
    phone: "5551991110001",
    email: "novo@empresa.com",
    address: "",
    notes: "",
    avatar_url: "",
  }
  const merged = mergeLoadedCustomerDetails(
    draft,
    {
      id: "cust-a",
      name: "Nome Antigo do Banco",
      phone: "5551991110001",
      email: "antigo@empresa.com",
      address: "Rua Carregada, 100",
      notes: "Observação prévia",
    },
    "cust-a",
    new Set(["name", "email"])
  )
  assert.equal(merged.name, "Nome Salvo pelo Operador")
  assert.equal(merged.email, "novo@empresa.com")
  assert.equal(merged.address, "Rua Carregada, 100")
  assert.equal(merged.notes, "Observação prévia")

  const convA: ConversationData = {
    company_id: "comp-1",
    id: "conv-a",
    customer_id: "cust-a",
    channel: "whatsapp",
    status: "open",
    assigned_to: null,
    last_message_at: "2026-11-26T15:00:00.000Z",
    created_at: "2026-11-26T15:00:00.000Z",
    unread_count: 0,
    customers: { id: "cust-a", name: "Antigo A" },
  }
  const convB: ConversationData = {
    ...convA,
    id: "conv-b",
    customer_id: "cust-b",
    customers: { id: "cust-b", name: "Intacto B" },
  }
  const updated = applyConfirmedCustomerUpdate([convA, convB], "conv-a", "cust-a", {
    name: "Nome Salvo pelo Operador",
    phone: "5551991110001",
    email: "novo@empresa.com",
    address: "Rua Carregada, 100",
    notes: "Observação prévia",
  })
  assert.equal(updated[0].customers?.name, "Nome Salvo pelo Operador")
  assert.equal(updated[1], convB)
})

test("UI-03.6 Confiabilidade 4 (Determinístico): Ownership alterado durante composição não desmonta rascunho nem corrompe contrato", () => {
  const root = process.cwd()
  const painelSrc = fs.readFileSync(
    path.join(root, "app/(dashboard)/conversations/components/painel-client.tsx"),
    "utf8"
  )
  const composerMatch = painelSrc.match(/<ConversationComposer[\s\S]*?\/>/)
  assert.ok(composerMatch, "ConversationComposer deve estar montado no PainelClient")
  // Key do composer depende apenas de activeConversation.id — alternar IA/humano mantém o texto em composição
  assert.match(composerMatch[0], /key=\{activeConversation\.id\}/)
  assert.doesNotMatch(composerMatch[0], /key=\{[^}]*assigned_to/)
  assert.doesNotMatch(composerMatch[0], /key=\{[^}]*ai_paused/)
})

test("UI-03.6 Confiabilidade 5 (Determinístico): Validação de anexos, falha de upload e limpeza determinística de recursos de áudio", () => {
  const oversize = validateAttachmentFile({
    name: "grande.pdf",
    size: 25 * 1024 * 1024,
    type: "application/pdf",
  })
  assert.equal(oversize.ok, false)

  const img = validateAttachmentFile({ name: "foto.png", size: 1024, type: "image/png" })
  const doc = validateAttachmentFile({ name: "proposta.pdf", size: 2048, type: "application/pdf" })
  const aud = validateAttachmentFile({ name: "voz.webm", size: 4096, type: "audio/webm" })
  assert.deepEqual(img, { ok: true, mediaType: "image" })
  assert.deepEqual(doc, { ok: true, mediaType: "document" })
  assert.deepEqual(aud, { ok: true, mediaType: "audio" })

  let stoppedRecorder = false
  let stoppedTracks = 0
  const refs = {
    timerRef: { current: null as ReturnType<typeof setInterval> | null },
    recorderRef: {
      current: {
        state: "recording",
        onstop: () => {},
        ondataavailable: () => {},
        stop: () => {
          stoppedRecorder = true
        },
      } as unknown as MediaRecorder,
    },
    streamRef: {
      current: {
        getTracks: () => [
          { stop: () => { stoppedTracks += 1 } },
          { stop: () => { stoppedTracks += 1 } },
        ],
      } as unknown as MediaStream,
    },
    chunksRef: { current: [new Blob(["abc"])] },
  }
  releaseAudioRecorderResources(refs)
  assert.equal(stoppedRecorder, true)
  assert.equal(stoppedTracks, 2)
  assert.equal(refs.recorderRef.current, null)
  assert.equal(refs.streamRef.current, null)
  assert.equal(refs.chunksRef.current.length, 0)
})

test("UI-03.6 Confiabilidade 6 (Determinístico): Proteção estrita de Nota Interna contra despacho externo e fallback de orçamento", () => {
  // Mesmo com anexo selecionado e gravador ativo, modo note NUNCA gera intent externo
  assert.equal(
    resolveComposerSubmitIntent({
      sendMode: "note",
      inputContent: "Anotação privada da equipe",
      hasSelectedFile: true,
      isRecording: true,
    }),
    "send_note"
  )
  assert.equal(
    resolveComposerSubmitIntent({
      sendMode: "note",
      inputContent: "   ",
      hasSelectedFile: true,
      isRecording: true,
    }),
    "noop"
  )

  const internalNote = makeMessage({
    id: "n-1",
    message_type: "internal_note",
    metadata: { is_internal: true },
  })
  assert.equal(classifyMessageAuthor(internalNote), "internal_note")

  // Fallback seguro de orçamento incompatível (retorna null sem inventar itens ou valores)
  assert.equal(parseCommercialQuoteText("Olá! Podemos agendar sua entrega amanhã às 14h?"), null)
})

test("UI-03.6 Confiabilidade 7 (Determinístico): Preservação da posição de rolagem durante leitura antiga", () => {
  // Usuário subiu 400px no histórico → NÃO deve puxar para o final
  assert.equal(
    isFeedNearBottom({
      scrollTop: 200,
      clientHeight: 500,
      scrollHeight: 1100,
    }),
    false
  )
  // Exatamente acima do limiar (97px) → ainda lendo histórico antigo
  assert.equal(
    isFeedNearBottom({
      scrollTop: 503,
      clientHeight: 500,
      scrollHeight: 1100,
      thresholdPx: FEED_PIN_TO_BOTTOM_THRESHOLD_PX,
    }),
    false
  )
  // Dentro do limiar (<= 96px) → acompanha novas mensagens
  assert.equal(
    isFeedNearBottom({
      scrollTop: 504,
      clientHeight: 500,
      scrollHeight: 1100,
      thresholdPx: FEED_PIN_TO_BOTTOM_THRESHOLD_PX,
    }),
    true
  )
})

test("UI-03.6 Etapa 4 (Contrato Arquitetural): Todos os 19 módulos extraídos memoizados e exatamente 2 subscriptions Realtime no orquestrador", () => {
  const root = process.cwd()
  const compDir = path.join(root, "app/(dashboard)/conversations/components")
  const extractedFiles = fs
    .readdirSync(compDir)
    .filter((f) => f.startsWith("conversation-") && f.endsWith(".tsx"))
    .sort()

  assert.equal(extractedFiles.length, 19, `Esperados 19 módulos extraídos, encontrados ${extractedFiles.length}`)

  for (const file of extractedFiles) {
    const src = fs.readFileSync(path.join(compDir, file), "utf8")
    assert.match(src, /React\.memo\(/, `${file} deve usar React.memo`)
    assert.doesNotMatch(src, /\.channel\(/, `${file} não pode abrir canal Realtime`)
    assert.doesNotMatch(src, /postgres_changes/, `${file} não pode criar subscription Realtime`)
  }

  const painelSrc = fs.readFileSync(path.join(compDir, "painel-client.tsx"), "utf8")
  const channelMatches = painelSrc.match(/\.channel\(/g) || []
  assert.equal(
    channelMatches.length,
    2,
    `PainelClient deve manter exatamente 2 canais Realtime (conversas + mensagens ativas), encontrados ${channelMatches.length}`
  )
})
