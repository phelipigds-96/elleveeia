import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  extractQuickReplyCategories,
  filterModalQuickReplies,
  filterSlashQuickReplies,
  findExactSlashQuickReply,
  formatRecordingTime,
  isStaleConversationLoad,
  mergeRealtimeInsertedMessage,
  reconcileOptimisticMessage,
  releaseAudioRecorderResources,
  resolveComposerSubmitIntent,
  validateAttachmentFile,
} from "../../lib/ui/conversations-composer"
import type { MessageData, QuickReply } from "../../app/(dashboard)/conversations/actions"

function makeMsg(overrides: Partial<MessageData> & { id: string }): MessageData {
  return {
    conversation_id: "conv-a",
    sender_type: "agent",
    content: "*Atendente André:*\nOlá!",
    message_type: "text",
    metadata: {},
    created_at: "2026-11-26T15:00:00.000Z",
    ...overrides,
  }
}

const SAMPLE_QUICK_REPLIES: QuickReply[] = [
  {
    id: "qr-1",
    companyId: "c1",
    title: "Chave Pix CNPJ",
    shortcut: "pix",
    content: "Segue nossa chave Pix.",
    category: "Financeiro",
    isActive: true,
    orderIndex: 0,
  },
  {
    id: "qr-2",
    companyId: "c1",
    title: "Horário de Funcionamento",
    shortcut: "horario",
    content: "Seg a Sex 08h às 18h.",
    category: "Geral",
    isActive: true,
    orderIndex: 1,
  },
  {
    id: "qr-3",
    companyId: "c1",
    title: "Resposta Inativa",
    shortcut: "inativo",
    content: "Não deve aparecer.",
    category: "Geral",
    isActive: false,
    orderIndex: 2,
  },
]

test("UI-03.4 Cenário 1: Troca rápida entre conversas rejeita respostas de rede fora de ordem (incluindo A → B → A)", () => {
  // Resposta de A chegou depois de trocar para B
  assert.equal(
    isStaleConversationLoad({
      activeConversationId: "conv-b",
      requestConversationId: "conv-a",
      activeSeq: 2,
      requestSeq: 1,
    }),
    true
  )

  // Resposta antiga de A (seq 1) chegou depois de A → B (seq 2) → A (seq 3)
  assert.equal(
    isStaleConversationLoad({
      activeConversationId: "conv-a",
      requestConversationId: "conv-a",
      activeSeq: 3,
      requestSeq: 1,
    }),
    true
  )

  // Resposta atual corresponde ao ID e sequência ativos
  assert.equal(
    isStaleConversationLoad({
      activeConversationId: "conv-a",
      requestConversationId: "conv-a",
      activeSeq: 3,
      requestSeq: 3,
    }),
    false
  )
})

test("UI-03.4 Cenário 2: Envio com timeout, confirmação tardia e Realtime fora de ordem nunca duplica mensagem", () => {
  const clientMsgId = "cid-1111"
  const tempId = `temp-${clientMsgId}`
  const realId = "msg-db-9999"

  const optimistic = makeMsg({
    id: tempId,
    metadata: { delivery_status: "pending", client_message_id: clientMsgId },
  })
  const realtimeDelivered = makeMsg({
    id: realId,
    content: "*Atendente André:*\nOlá! (normalizado pelo servidor)",
    metadata: { delivery_status: "sent", client_message_id: clientMsgId },
  })

  // Caso A: Realtime chega ANTES da confirmação tardia do sendMessageAction (ex: após latência/timeout)
  const afterRealtime = mergeRealtimeInsertedMessage([optimistic], realtimeDelivered)
  assert.equal(afterRealtime.length, 1)
  assert.equal(afterRealtime[0].id, realId)

  // Confirmação tardia chega depois com o mesmo realId — não cria duplicata
  const afterLateConfirm = reconcileOptimisticMessage(afterRealtime, tempId, realId, {
    delivery_status: "sent",
  })
  assert.equal(afterLateConfirm.length, 1)
  assert.equal(afterLateConfirm[0].id, realId)

  // Caso B: Ambos tempId e realId coexistiam por divergência de conteúdo — reconciliação remove tempId
  const bothPresent = [optimistic, realtimeDelivered]
  const reconciled = reconcileOptimisticMessage(bothPresent, tempId, realId, {
    delivery_status: "sent",
  })
  assert.equal(reconciled.length, 1)
  assert.equal(reconciled[0].id, realId)

  // Caso C: Confirmação chega primeiro e Realtime chega depois
  const afterConfirmFirst = reconcileOptimisticMessage([optimistic], tempId, realId, {
    delivery_status: "sent",
  })
  const afterRealtimeSecond = mergeRealtimeInsertedMessage(afterConfirmFirst, realtimeDelivered)
  assert.equal(afterRealtimeSecond.length, 1)
  assert.equal(afterRealtimeSecond[0].id, realId)
})

test("UI-03.4 Cenário 3: Isolamento estrito de Nota Interna impede vazamento para canal externo WhatsApp", () => {
  assert.equal(
    resolveComposerSubmitIntent({
      sendMode: "note",
      inputContent: "Anotação confidencial de margem",
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

  assert.equal(
    resolveComposerSubmitIntent({
      sendMode: "whatsapp",
      inputContent: "Olá cliente",
      hasSelectedFile: false,
      isRecording: false,
    }),
    "send_text"
  )

  assert.equal(
    resolveComposerSubmitIntent({
      sendMode: "whatsapp",
      inputContent: "Legenda",
      hasSelectedFile: true,
      isRecording: false,
    }),
    "send_attachment"
  )

  assert.equal(
    resolveComposerSubmitIntent({
      sendMode: "whatsapp",
      inputContent: "",
      hasSelectedFile: false,
      isRecording: true,
    }),
    "stop_send_audio"
  )
})

test("UI-03.4 Cenário 4: Validação de anexos, formatação de áudio e busca/atalhos de respostas rápidas", () => {
  assert.deepEqual(
    validateAttachmentFile({ name: "foto.jpg", size: 1024, type: "image/jpeg" }),
    { ok: true, mediaType: "image" }
  )
  assert.deepEqual(
    validateAttachmentFile({ name: "proposta.pdf", size: 4096, type: "application/pdf" }),
    { ok: true, mediaType: "document" }
  )
  assert.deepEqual(
    validateAttachmentFile({ name: "voz.ogg", size: 2048, type: "audio/ogg" }),
    { ok: true, mediaType: "audio" }
  )
  const tooLarge = validateAttachmentFile({
    name: "gigante.pdf",
    size: MAX_ATTACHMENT_SIZE_BYTES + 1,
    type: "application/pdf",
  })
  assert.equal(tooLarge.ok, false)

  assert.equal(formatRecordingTime(0), "0:00")
  assert.equal(formatRecordingTime(65), "1:05")
  assert.equal(formatRecordingTime(-3), "0:00")

  assert.equal(filterSlashQuickReplies(SAMPLE_QUICK_REPLIES, "/").length, 2)
  assert.equal(filterSlashQuickReplies(SAMPLE_QUICK_REPLIES, "/pix").length, 1)
  assert.equal(findExactSlashQuickReply(SAMPLE_QUICK_REPLIES, "/pix")?.id, "qr-1")
  assert.equal(findExactSlashQuickReply(SAMPLE_QUICK_REPLIES, "/inativo"), null)
  assert.deepEqual(extractQuickReplyCategories(SAMPLE_QUICK_REPLIES), ["Financeiro", "Geral"])
  assert.equal(filterModalQuickReplies(SAMPLE_QUICK_REPLIES, "pix", "TODAS").length, 1)
  assert.equal(filterModalQuickReplies(SAMPLE_QUICK_REPLIES, "", "Geral").length, 1)
})

test("UI-03.4 Cenário 5: Cancelamento/interrupção de gravação de áudio libera timer, MediaRecorder e tracks de microfone", () => {
  let stoppedTracks = 0
  let recorderStopped = false
  let timerCleared = false

  const fakeInterval = setInterval(() => {
    timerCleared = false
  }, 60000)

  const fakeTrack = {
    stop() {
      stoppedTracks++
    },
  } as unknown as MediaStreamTrack

  const fakeStream = {
    getTracks: () => [fakeTrack, fakeTrack],
  } as unknown as MediaStream

  const fakeRecorder = {
    state: "recording",
    onstop: () => {},
    ondataavailable: () => {},
    stop() {
      recorderStopped = true
      this.state = "inactive"
    },
  } as unknown as MediaRecorder

  const refs = {
    timerRef: { current: fakeInterval as ReturnType<typeof setInterval> | null },
    recorderRef: { current: fakeRecorder as MediaRecorder | null },
    streamRef: { current: fakeStream as MediaStream | null },
    chunksRef: { current: [new Blob(["audio"])] },
  }

  releaseAudioRecorderResources(refs)
  timerCleared = refs.timerRef.current === null

  assert.equal(timerCleared, true)
  assert.equal(recorderStopped, true)
  assert.equal(stoppedTracks, 2)
  assert.equal(refs.recorderRef.current, null)
  assert.equal(refs.streamRef.current, null)
  assert.equal(refs.chunksRef.current.length, 0)
})

test("UI-03.4 Cenário 6: Contratos estruturais de modularização, isolamento de rascunhos, trava de duplo clique e zero novas subscriptions", () => {
  const root = process.cwd()
  const painelSrc = fs.readFileSync(
    path.join(root, "app/(dashboard)/conversations/components/painel-client.tsx"),
    "utf8"
  )
  const composerSrc = fs.readFileSync(
    path.join(root, "app/(dashboard)/conversations/components/conversation-composer.tsx"),
    "utf8"
  )
  const actionsSrc = fs.readFileSync(
    path.join(root, "app/(dashboard)/conversations/components/conversation-composer-actions.tsx"),
    "utf8"
  )
  const audioSrc = fs.readFileSync(
    path.join(root, "app/(dashboard)/conversations/components/conversation-audio-recorder.tsx"),
    "utf8"
  )
  const quickSrc = fs.readFileSync(
    path.join(root, "app/(dashboard)/conversations/components/conversation-quick-replies.tsx"),
    "utf8"
  )

  // Isolamento de rascunho/anexo por conversa via key={activeConversation.id}
  assert.match(painelSrc, /<ConversationComposer[\s\S]*?key=\{activeConversation\.id\}/)
  // Trava síncrona de duplo clique e sequência anti-race na carga de mensagens
  assert.match(painelSrc, /sendingLockRef/)
  assert.match(painelSrc, /loadMessagesSeqRef/)
  assert.match(painelSrc, /isStaleConversationLoad/)
  assert.match(painelSrc, /mergeRealtimeInsertedMessage/)
  assert.match(painelSrc, /reconcileOptimisticMessage/)
  // Estados locais do composer removidos do orquestrador PainelClient
  assert.doesNotMatch(painelSrc, /setInputContent\(/)
  assert.doesNotMatch(painelSrc, /setSelectedFile\(/)
  assert.doesNotMatch(painelSrc, /setIsRecording\(/)
  assert.doesNotMatch(painelSrc, /setSendMode\(/)

  // Todos os módulos extraídos usam React.memo e ZERO subscriptions Realtime ou Server Actions diretas
  for (const src of [composerSrc, actionsSrc, audioSrc, quickSrc]) {
    assert.match(src, /React\.memo\(/)
    assert.doesNotMatch(src, /\.channel\(/)
    assert.doesNotMatch(src, /postgres_changes/)
    assert.doesNotMatch(src, /sendMessageAction/)
    assert.doesNotMatch(src, /sendMediaMessageAction/)
    assert.doesNotMatch(src, /createInternalNoteAction/)
  }

  // Preservação da trava de duplo clique, cleanup no unmount, privacidade da nota e altura dinâmica mobile
  assert.match(composerSrc, /submitGuardRef/)
  assert.match(composerSrc, /releaseAudioRecorderResources/)
  assert.match(composerSrc, /Privada · não enviada ao cliente/)
  assert.match(composerSrc, /Ao enviar, a IA pausa/)
  assert.match(quickSrc, /calc\(var\(--ellevee-vvh,100dvh\)-1rem\)/)
})
