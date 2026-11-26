import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import {
  applyConfirmedCustomerUpdate,
  areInternalNotesEqual,
  buildInitialCustomerDraft,
  canConfirmCloseConversation,
  getActiveCloseReasons,
  getCloseReasonDotClass,
  isStaleCustomerProfileLoad,
  mergeLoadedCustomerDetails,
  sanitizeWhatsAppDigits,
} from "../../lib/ui/conversations-inspector"
import type { CloseReason, ConversationData, MessageData } from "../../app/(dashboard)/conversations/actions"

function makeConv(overrides: Partial<ConversationData> & { id: string }): ConversationData {
  return {
    company_id: "comp-1",
    customer_id: "cust-1",
    channel: "whatsapp",
    status: "open",
    assigned_to: null,
    last_message_at: "2026-11-26T12:00:00.000Z",
    created_at: "2026-11-26T12:00:00.000Z",
    unread_count: 0,
    customers: {
      id: "cust-1",
      name: "Cliente A",
      phone: "5511999991111",
      email: "a@example.com",
    },
    ...overrides,
  }
}

test("UI-03.5 Cenário 1: mergeLoadedCustomerDetails bloqueia contaminação cruzada entre contatos diferentes", () => {
  const initialDraft = buildInitialCustomerDraft({
    customerId: "cust-b",
    customer: { id: "cust-b", name: "Cliente B", phone: "5511888882222" },
  })

  // Resposta tardia de cust-a não deve sobrescrever draft de cust-b
  const afterWrongCustomer = mergeLoadedCustomerDetails(
    initialDraft,
    { id: "cust-a", name: "Cliente A Vazado", phone: "5511999991111", email: "vazado@example.com" },
    "cust-b"
  )
  assert.equal(afterWrongCustomer.name, "Cliente B")
  assert.equal(afterWrongCustomer.email, "")

  // Resposta correta de cust-b mescla normalmente
  const afterMatchingCustomer = mergeLoadedCustomerDetails(
    initialDraft,
    {
      id: "cust-b",
      name: "Cliente B Completo",
      phone: "5511888882222",
      email: "b@example.com",
      address: "Av. Paulista, 1000",
      notes: "VIP",
    },
    "cust-b"
  )
  assert.equal(afterMatchingCustomer.name, "Cliente B Completo")
  assert.equal(afterMatchingCustomer.email, "b@example.com")
  assert.equal(afterMatchingCustomer.address, "Av. Paulista, 1000")
  assert.equal(afterMatchingCustomer.notes, "VIP")

  // Campos já editados localmente não são sobrescritos por carregamento assíncrono tardio
  const editedDraft = { ...initialDraft, name: "Nome Editado Local", email: "editado@local.com" }
  const afterStaleLoad = mergeLoadedCustomerDetails(
    editedDraft,
    {
      id: "cust-b",
      name: "Cliente B Antigo",
      phone: "5511888882222",
      email: "antigo@example.com",
      address: "Rua Carregada, 42",
      notes: "Obs Servidor",
    },
    "cust-b",
    new Set(["name", "email"])
  )
  assert.equal(afterStaleLoad.name, "Nome Editado Local")
  assert.equal(afterStaleLoad.email, "editado@local.com")
  assert.equal(afterStaleLoad.address, "Rua Carregada, 42")
  assert.equal(afterStaleLoad.notes, "Obs Servidor")
})

test("UI-03.5 Cenário 2: isStaleCustomerProfileLoad descarta respostas fora de ordem em trocas rápidas (A → B → A)", () => {
  assert.equal(
    isStaleCustomerProfileLoad({
      activeConversationId: "conv-b",
      requestConversationId: "conv-a",
      activeCustomerId: "cust-b",
      requestCustomerId: "cust-a",
      activeSeq: 2,
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

test("UI-03.5 Cenário 3: applyConfirmedCustomerUpdate atualiza apenas o contato confirmado e areInternalNotesEqual preserva estabilidade", () => {
  const convA = makeConv({ id: "conv-a", customer_id: "cust-a" })
  const convB = makeConv({
    id: "conv-b",
    customer_id: "cust-b",
    customers: { id: "cust-b", name: "Cliente B", phone: "5511888882222" },
  })

  const updated = applyConfirmedCustomerUpdate([convA, convB], "conv-a", "cust-a", {
    name: "Cliente A Editado",
    phone: "5511999990000",
    email: "editado@example.com",
    address: "Rua Nova, 10",
    notes: "Obs",
  })

  assert.equal(updated[0].customers?.name, "Cliente A Editado")
  assert.equal(updated[0].customers?.email, "editado@example.com")
  assert.equal(updated[1].customers?.name, "Cliente B")
  assert.equal(updated[1], convB)

  const n1: MessageData = {
    id: "n1",
    conversation_id: "conv-a",
    sender_type: "human",
    message_type: "internal_note",
    content: "Nota 1",
    created_at: "2026-11-26T12:00:00.000Z",
  }
  assert.equal(areInternalNotesEqual([n1], [{ ...n1 }]), true)
  assert.equal(areInternalNotesEqual([n1], [{ ...n1, id: "n2" }]), false)
})

test("UI-03.5 Cenário 4: Regras de encerramento com motivo obrigatório/opcional e sanitização de telefone", () => {
  const reasons: CloseReason[] = [
    { id: "r1", companyId: "c1", title: "Venda Concluída", color: "emerald", isActive: true, orderIndex: 0 },
    { id: "r2", companyId: "c1", title: "Inativo", color: "rose", isActive: false, orderIndex: 1 },
  ]
  assert.equal(getActiveCloseReasons(reasons).length, 1)
  assert.equal(getCloseReasonDotClass("emerald"), "bg-emerald-500")
  assert.equal(getCloseReasonDotClass("unknown"), "bg-slate-500")
  assert.equal(sanitizeWhatsAppDigits("+55 (51) 99999-1234"), "5551999991234")

  assert.equal(
    canConfirmCloseConversation({ isClosing: false, requireCloseReason: true, selectedReasonId: null }),
    false
  )
  assert.equal(
    canConfirmCloseConversation({ isClosing: false, requireCloseReason: true, selectedReasonId: "r1" }),
    true
  )
  assert.equal(
    canConfirmCloseConversation({ isClosing: true, requireCloseReason: false, selectedReasonId: "r1" }),
    false
  )
})

test("UI-03.5 Cenário 5: Contratos estruturais de modularização, isolamento, zero novas subscriptions e alvos 44px em tablet/mobile", () => {
  const root = process.cwd()
  const painelSrc = fs.readFileSync(
    path.join(root, "app/(dashboard)/conversations/components/painel-client.tsx"),
    "utf8"
  )
  const inspectorSrc = fs.readFileSync(
    path.join(root, "app/(dashboard)/conversations/components/conversation-customer-inspector.tsx"),
    "utf8"
  )
  const profileSrc = fs.readFileSync(
    path.join(root, "app/(dashboard)/conversations/components/conversation-customer-profile.tsx"),
    "utf8"
  )
  const notesSrc = fs.readFileSync(
    path.join(root, "app/(dashboard)/conversations/components/conversation-internal-notes.tsx"),
    "utf8"
  )
  const dialogsSrc = fs.readFileSync(
    path.join(root, "app/(dashboard)/conversations/components/conversation-lifecycle-dialogs.tsx"),
    "utf8"
  )
  const newChatSrc = fs.readFileSync(
    path.join(root, "app/(dashboard)/conversations/components/conversation-new-chat-dialog.tsx"),
    "utf8"
  )

  // PainelClient delega Inspector e todos os modais operacionais sem estados de formulário duplicados
  assert.match(painelSrc, /<ConversationCustomerInspector/)
  assert.match(painelSrc, /<ConversationImageLightbox/)
  assert.match(painelSrc, /<ConversationNewChatDialog/)
  assert.match(painelSrc, /<ConversationCloseDialog/)
  assert.match(painelSrc, /<ConversationStageDialog/)
  assert.doesNotMatch(painelSrc, /setCustomerForm\(/)
  assert.doesNotMatch(painelSrc, /setQuickNoteContent\(/)
  assert.doesNotMatch(painelSrc, /setNewChatPhone\(/)
  assert.doesNotMatch(painelSrc, /setSelectedReasonId\(/)

  // Todos os componentes extraídos usam React.memo e ZERO subscriptions Realtime ou Server Actions diretas
  for (const src of [inspectorSrc, profileSrc, notesSrc, dialogsSrc, newChatSrc]) {
    assert.match(src, /React\.memo\(/)
    assert.doesNotMatch(src, /\.channel\(/)
    assert.doesNotMatch(src, /postgres_changes/)
    assert.doesNotMatch(src, /updateCustomerProfileAction/)
    assert.doesNotMatch(src, /createInternalNoteAction/)
    assert.doesNotMatch(src, /closeConversationAction/)
    assert.doesNotMatch(src, /startNewConversationAction/)
  }

  // Isolamento por key no Inspector + guarda anti-race no Perfil + alvos >= 44px em mobile/tablet (< lg)
  assert.match(inspectorSrc, /key=\{`\$\{conversationId\}:\$\{customerId\}`\}/)
  assert.match(inspectorSrc, /key=\{conversationId\}/)
  assert.match(inspectorSrc, /min-h-\[44px\] lg:min-h-\[28px\]/)
  assert.match(profileSrc, /isStaleCustomerProfileLoad/)
  assert.match(profileSrc, /mergeLoadedCustomerDetails/)
  assert.match(profileSrc, /min-h-\[44px\] lg:min-h-\[38px\]/)
  assert.match(notesSrc, /min-h-\[44px\] lg:min-h-\[36px\]/)
  assert.match(dialogsSrc, /h-11 w-11 lg:h-9 lg:w-9/)
  assert.match(newChatSrc, /h-11 w-11 lg:h-9 lg:w-9/)
})
