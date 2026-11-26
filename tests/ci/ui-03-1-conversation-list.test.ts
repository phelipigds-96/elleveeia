import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import type { ConversationData } from "../../app/(dashboard)/conversations/actions"
import {
  computeConversationCounts,
  filterConversations,
  formatConversationTimeAgo,
  formatConversationWaitTime,
  getCustomerInitials,
  getDefaultConversationTab,
  resolveConversationStageColor,
} from "../../lib/ui/conversations-list"

const PROJECT_ROOT = process.cwd()

function makeConversation(overrides: Partial<ConversationData> & { id: string }): ConversationData {
  return {
    id: overrides.id,
    company_id: "comp-1",
    customer_id: `cust-${overrides.id}`,
    channel: "whatsapp",
    status: "open",
    assigned_to: null,
    started_at: "2026-11-26T10:00:00.000Z",
    last_message_at: "2026-11-26T11:55:00.000Z",
    closed_at: null,
    created_at: "2026-11-26T10:00:00.000Z",
    updated_at: "2026-11-26T11:55:00.000Z",
    unread_count: 0,
    external_id: "5511999990000",
    agent_id: null,
    agent_name: "Sofia",
    customers: {
      id: `cust-${overrides.id}`,
      name: "Cliente Padrão",
      phone: "5511999990000",
    },
    last_message_preview: "Olá!",
    ...overrides,
  }
}

test("UI-03.1 Cenário 1: computeConversationCounts e getDefaultConversationTab preservam taxonomia e contadores exatos", () => {
  assert.equal(getDefaultConversationTab(true), "all")
  assert.equal(getDefaultConversationTab(false), "waiting")

  const list: ConversationData[] = [
    makeConversation({ id: "c1", status: "human", assigned_to: null }),
    makeConversation({ id: "c2", status: "human", assigned_to: "op-1" }),
    makeConversation({ id: "c3", status: "open", assigned_to: null }),
    makeConversation({ id: "c4", status: "open", assigned_to: null }),
    makeConversation({ id: "c5", status: "closed", assigned_to: null }),
  ]

  assert.deepEqual(computeConversationCounts(list), {
    all: 5,
    waiting: 1,
    inProgress: 1,
    ai: 2,
    closed: 1,
  })
})

test("UI-03.1 Cenário 2: filterConversations preserva filtragem por aba, nome, telefone, prévia e ordem original", () => {
  const list: ConversationData[] = [
    makeConversation({
      id: "c-wait",
      status: "human",
      assigned_to: null,
      customers: { id: "u1", name: "Maria Oliveira", phone: "5511988881111" },
      last_message_preview: "Quero 2 caixas de leite",
    }),
    makeConversation({
      id: "c-human",
      status: "human",
      assigned_to: "op-1",
      customers: { id: "u2", name: "João Pedro", phone: "5511977772222" },
      last_message_preview: "Pedido confirmado",
    }),
    makeConversation({
      id: "c-ai",
      status: "open",
      assigned_to: null,
      customers: { id: "u3", name: "Mercado Central", phone: "5511966663333" },
      last_message_preview: "Qual valor no atacado?",
    }),
    makeConversation({
      id: "c-closed",
      status: "closed",
      assigned_to: null,
      customers: { id: "u4", name: "Padaria Sul", phone: "5511955554444" },
      last_message_preview: "Obrigado!",
    }),
  ]

  assert.deepEqual(
    filterConversations(list, "all", "").map((c) => c.id),
    ["c-wait", "c-human", "c-ai", "c-closed"]
  )
  assert.deepEqual(
    filterConversations(list, "waiting", "").map((c) => c.id),
    ["c-wait"]
  )
  assert.deepEqual(
    filterConversations(list, "in_progress", "").map((c) => c.id),
    ["c-human"]
  )
  assert.deepEqual(
    filterConversations(list, "ai", "").map((c) => c.id),
    ["c-ai"]
  )
  assert.deepEqual(
    filterConversations(list, "closed", "").map((c) => c.id),
    ["c-closed"]
  )

  // Busca por nome, telefone e prévia (case-insensitive)
  assert.deepEqual(
    filterConversations(list, "all", "maria").map((c) => c.id),
    ["c-wait"]
  )
  assert.deepEqual(
    filterConversations(list, "all", "977772222").map((c) => c.id),
    ["c-human"]
  )
  assert.deepEqual(
    filterConversations(list, "all", "ATACADO").map((c) => c.id),
    ["c-ai"]
  )
  assert.deepEqual(filterConversations(list, "closed", "atacado"), [])
})

test("UI-03.1 Cenário 3: Helpers puros de cor de etapa, iniciais e tempo relativo preservam formatação determinística", () => {
  assert.equal(resolveConversationStageColor({ workflow_stage_color: "#7028D9" }), "#7028D9")
  assert.equal(resolveConversationStageColor({ stage_color: " #0067b8 " }), "#0067b8")
  assert.equal(resolveConversationStageColor({ workflow_stages: { color: "#123456" } }), "#123456")
  assert.equal(resolveConversationStageColor({ workflow_stage_color: "javascript:alert(1)" }), "#64748b")
  assert.equal(resolveConversationStageColor(null), "#64748b")

  assert.equal(getCustomerInitials("Maria Silva Souza"), "MS")
  assert.equal(getCustomerInitials("João"), "J")
  assert.equal(getCustomerInitials(""), "CD")

  const now = new Date("2026-11-26T12:00:00.000Z").getTime()
  assert.equal(formatConversationTimeAgo("2026-11-26T11:59:40.000Z", now), "agora")
  assert.equal(formatConversationTimeAgo("2026-11-26T11:45:00.000Z", now), "há 15m")
  assert.equal(formatConversationTimeAgo("2026-11-26T09:00:00.000Z", now), "há 3h")
  assert.equal(formatConversationTimeAgo("2026-11-24T12:00:00.000Z", now), "há 2d")

  assert.equal(formatConversationWaitTime("2026-11-26T11:59:50.000Z", now), "instantes")
  assert.equal(formatConversationWaitTime("2026-11-26T11:48:00.000Z", now), "12 min")
  assert.equal(formatConversationWaitTime("2026-11-26T10:00:00.000Z", now), "2h")
  assert.equal(formatConversationWaitTime("2026-11-24T12:00:00.000Z", now), "2d")
})

test("UI-03.1 Cenário 4: Contratos estruturais de modularização, memoização e estabilidade de props", () => {
  const convDir = path.join(PROJECT_ROOT, "app", "(dashboard)", "conversations", "components")
  const painelSrc = fs.readFileSync(path.join(convDir, "painel-client.tsx"), "utf8")
  const paneSrc = fs.readFileSync(path.join(convDir, "conversation-list-pane.tsx"), "utf8")
  const itemSrc = fs.readFileSync(path.join(convDir, "conversation-list-item.tsx"), "utf8")
  const filtersSrc = fs.readFileSync(path.join(convDir, "conversation-list-filters.tsx"), "utf8")

  // Orquestrador delega a lista para ConversationListPane sem duplicar Realtime
  assert.ok(painelSrc.includes("<ConversationListPane"), "PainelClient deve renderizar ConversationListPane")
  assert.equal(paneSrc.includes("createClient"), false, "ConversationListPane não pode criar nova inscrição Realtime")
  assert.equal(itemSrc.includes("createClient"), false, "ConversationListItem não pode criar inscrição Realtime")
  assert.equal(filtersSrc.includes("createClient"), false, "ConversationListFilters não pode criar inscrição Realtime")

  // Estabilidade de callbacks e React.memo
  assert.match(painelSrc, /const handleSelectConversation = useCallback\(/)
  assert.match(painelSrc, /const handleOpenNewChat = useCallback\(/)
  assert.ok(paneSrc.includes("React.memo(ConversationListPaneComponent)"))
  assert.ok(itemSrc.includes("React.memo(ConversationListItemComponent)"))
  assert.ok(filtersSrc.includes("React.memo(ConversationListFiltersComponent)"))

  // Acessibilidade, alvos >= 44px e tokens UI-02 preservados na lista extraída
  assert.ok(paneSrc.includes('aria-label="Lista de conversas"'))
  assert.ok(paneSrc.includes('aria-label="Buscar contato"'))
  assert.ok(filtersSrc.includes('role="tablist"'))
  assert.ok(filtersSrc.includes("min-h-[44px]"))
  assert.ok(itemSrc.includes("aria-current={isSelected ? \"true\" : undefined}"))
  assert.ok(itemSrc.includes("resolveAiStatusDetail"))

  // Sem cores legadas do WhatsApp nos novos módulos
  for (const src of [paneSrc, itemSrc, filtersSrc]) {
    for (const forbidden of ["#005d4b", "#004738", "#efeae2", "#d9fdd3", "ellevee-note-"]) {
      assert.equal(src.includes(forbidden), false, `Módulo da lista contém token legado: ${forbidden}`)
    }
  }
})
