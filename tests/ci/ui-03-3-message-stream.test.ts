import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import {
  buildMessageFeedEntries,
  classifyMessageAuthor,
  formatMessageDayLabel,
  formatMessageTime,
  getMessageDisplayContent,
  isAudioMessage,
  resolveMessageDeliveryStatus,
  resolveMessageMedia,
} from "../../lib/ui/conversations-messages"
import { parseCommercialQuoteText } from "../../lib/ui/conversations-quote-card"
import type { MessageData } from "../../app/(dashboard)/conversations/actions"

function makeMsg(overrides: Partial<MessageData> & { id: string }): MessageData {
  return {
    conversation_id: "conv-1",
    sender_type: "customer",
    content: "Mensagem de teste",
    message_type: "text",
    metadata: {},
    created_at: "2026-11-26T12:00:00.000Z",
    ...overrides,
  }
}

test("UI-03.3 Cenário 1: classifyMessageAuthor diferencia sistema, nota interna, cliente, humano e Sofia IA", () => {
  assert.equal(
    classifyMessageAuthor(makeMsg({ id: "m1", sender_type: "system", message_type: "event" })),
    "system"
  )
  assert.equal(
    classifyMessageAuthor(makeMsg({ id: "m2", sender_type: "human", message_type: "event" })),
    "system"
  )
  assert.equal(
    classifyMessageAuthor(
      makeMsg({ id: "m3", sender_type: "human", message_type: "internal_note", metadata: { is_internal: true } })
    ),
    "internal_note"
  )
  assert.equal(
    classifyMessageAuthor(makeMsg({ id: "m4", sender_type: "customer" })),
    "customer"
  )
  assert.equal(
    classifyMessageAuthor(makeMsg({ id: "m5", sender_type: "human", sender_id: "user-1" })),
    "human"
  )
  assert.equal(
    classifyMessageAuthor(makeMsg({ id: "m6", sender_type: "agent", sender_id: "user-1" })),
    "human"
  )
  assert.equal(
    classifyMessageAuthor(makeMsg({ id: "m7", sender_type: "ia", sender_id: null })),
    "ai"
  )
  assert.equal(
    classifyMessageAuthor(makeMsg({ id: "m8", sender_type: "agent", sender_id: null })),
    "ai"
  )
})

test("UI-03.3 Cenário 2: resolveMessageMedia, getMessageDisplayContent e resolveMessageDeliveryStatus preservam fidelidade", () => {
  const imgMsg = makeMsg({
    id: "img-1",
    sender_type: "human",
    message_type: "image",
    content: "[Imagem]",
    metadata: {
      media_type: "image",
      media_url: "https://cdn.example.com/amostra.jpg",
      file_name: "amostra.jpg",
      delivery_status: "delivered",
    },
  })
  assert.deepEqual(resolveMessageMedia(imgMsg), {
    url: "https://cdn.example.com/amostra.jpg",
    type: "image",
    fileName: "amostra.jpg",
  })
  assert.equal(getMessageDisplayContent(imgMsg), null)
  assert.equal(resolveMessageDeliveryStatus(imgMsg), "delivered")

  const audioMsg = makeMsg({
    id: "aud-1",
    sender_type: "customer",
    message_type: "audio",
    content: "[Mensagem de Voz]",
    metadata: {
      media_type: "audio",
      media_url: "https://cdn.example.com/voz.ogg",
      file_name: "voz.ogg",
    },
  })
  assert.equal(isAudioMessage(audioMsg), true)
  assert.equal(resolveMessageMedia(audioMsg)?.type, "audio")
  assert.equal(getMessageDisplayContent(audioMsg), null)
  assert.equal(resolveMessageDeliveryStatus(audioMsg), null)

  const docMsg = makeMsg({
    id: "doc-1",
    sender_type: "agent",
    message_type: "document",
    content: "*Atendente André:*\n[Documento]\nSegue o catálogo atualizado.",
    metadata: {
      media_type: "document",
      media_url: "https://cdn.example.com/catalogo.pdf",
      file_name: "catalogo.pdf",
      delivery_status: "failed",
    },
  })
  assert.equal(resolveMessageMedia(docMsg)?.type, "document")
  assert.equal(resolveMessageDeliveryStatus(docMsg), "failed")
  // Texto real não é suprimido; conteúdo sem media_url nunca perde placeholders
  const brokenMediaMsg = makeMsg({
    id: "broken-1",
    sender_type: "customer",
    message_type: "image",
    content: "[Imagem]",
    metadata: {},
  })
  assert.equal(resolveMessageMedia(brokenMediaMsg), null)
  assert.equal(getMessageDisplayContent(brokenMediaMsg), "[Imagem]")

  const rawText = "Painel Ripado Carvalho Natural — R$ 289,90/un"
  assert.equal(getMessageDisplayContent(makeMsg({ id: "txt-1", content: rawText })), rawText)
})

test("UI-03.3 Cenário 3: buildMessageFeedEntries ordena, deduplica por ID e insere divisores de dia determinísticos", () => {
  const refDate = new Date("2026-11-26T15:00:00.000Z")
  const m1 = makeMsg({ id: "a1", created_at: "2026-11-24T13:00:00.000Z", content: "Dois dias atrás" })
  const m2 = makeMsg({ id: "a2", created_at: "2026-11-25T13:00:00.000Z", content: "Ontem" })
  const m3 = makeMsg({ id: "a3", created_at: "2026-11-26T13:00:00.000Z", content: "Hoje 1" })
  const m3Dup = makeMsg({ id: "a3", created_at: "2026-11-26T13:00:00.000Z", content: "Duplicada" })
  const m4 = makeMsg({ id: "a4", created_at: "2026-11-26T14:00:00.000Z", content: "Hoje 2" })

  const entries = buildMessageFeedEntries([m1, m2, m3, m3Dup, m4], refDate)
  const dividers = entries.filter((e) => e.kind === "divider")
  const msgs = entries.filter((e) => e.kind === "message")

  assert.equal(msgs.length, 4)
  assert.deepEqual(
    msgs.map((e) => e.id),
    ["a1", "a2", "a3", "a4"]
  )
  assert.equal(dividers.length, 3)
  assert.equal(dividers[1].label, "Ontem")
  assert.equal(dividers[2].label, "Hoje")
  assert.equal(formatMessageDayLabel("2026-11-26T13:00:00.000Z", refDate), "Hoje")
  assert.ok(formatMessageTime("2026-11-26T13:00:00.000Z").length >= 4)

  // Fallback seguro de orçamento malformado permanece nulo (exibe texto bruto original)
  assert.equal(parseCommercialQuoteText("ORÇAMENTO COMERCIAL\nLinha inesperada sem itens"), null)
})

test("UI-03.3 Cenário 4: Contratos estruturais de modularização, memoização, segurança XSS e preservação de scroll", () => {
  const root = process.cwd()
  const painelSrc = fs.readFileSync(
    path.join(root, "app/(dashboard)/conversations/components/painel-client.tsx"),
    "utf8"
  )
  const streamSrc = fs.readFileSync(
    path.join(root, "app/(dashboard)/conversations/components/conversation-message-stream.tsx"),
    "utf8"
  )
  const itemSrc = fs.readFileSync(
    path.join(root, "app/(dashboard)/conversations/components/conversation-message-item.tsx"),
    "utf8"
  )
  const contentSrc = fs.readFileSync(
    path.join(root, "app/(dashboard)/conversations/components/conversation-message-content.tsx"),
    "utf8"
  )
  const systemSrc = fs.readFileSync(
    path.join(root, "app/(dashboard)/conversations/components/conversation-system-event.tsx"),
    "utf8"
  )

  // PainelClient delega o histórico ao ConversationMessageStream mantendo feedContainerRef e isFeedNearBottom
  assert.match(painelSrc, /<ConversationMessageStream/)
  assert.match(painelSrc, /feedContainerRef/)
  assert.match(painelSrc, /isFeedNearBottom/)
  assert.match(painelSrc, /handleRetryMessage/)
  assert.doesNotMatch(painelSrc, /function WhatsAppAudioPlayer\(/)
  assert.doesNotMatch(painelSrc, /function MessageMedia\(/)

  // Todos os componentes extraídos usam React.memo e ZERO HTML arbitrário / novas subscriptions Realtime
  for (const src of [streamSrc, itemSrc, contentSrc, systemSrc]) {
    assert.match(src, /React\.memo\(/)
    assert.doesNotMatch(src, /dangerouslySetInnerHTML/)
    assert.doesNotMatch(src, /\.channel\(/)
    assert.doesNotMatch(src, /postgres_changes/)
  }

  // Preserva atributos de acessibilidade e privacidade de nota interna
  assert.match(streamSrc, /role="log"/)
  assert.match(streamSrc, /aria-live="polite"/)
  assert.match(streamSrc, /overscroll-contain/)
  assert.match(itemSrc, /Privada \(somente equipe\)/)
  assert.match(itemSrc, /parseCommercialQuoteText/)
  assert.match(contentSrc, /line-clamp-2/)
})
