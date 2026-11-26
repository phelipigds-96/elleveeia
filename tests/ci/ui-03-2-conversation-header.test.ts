import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import {
  formatConversationPhone,
  isHeaderActionLocked,
  resolveHeaderOwnershipView,
  resolveReturnToAiLabel,
} from "../../lib/ui/conversations-header"

const PROJECT_ROOT = process.cwd()

test("UI-03.2 Cenário 1: resolveHeaderOwnershipView distingue Sofia IA, humano, aguardando e finalizado sem redundância", () => {
  assert.deepEqual(
    resolveHeaderOwnershipView({ status: "open", assignedTo: null, currentUserId: "u1", agentName: "Sofia" }),
    { tone: "ai", label: "IA ativa · Sofia" }
  )
  assert.deepEqual(
    resolveHeaderOwnershipView({ status: "open", assignedTo: null, currentUserId: "u1", agentName: "IA" }),
    { tone: "ai", label: "IA ativa" }
  )
  assert.deepEqual(
    resolveHeaderOwnershipView({ status: "human", assignedTo: null, currentUserId: "u1", agentName: "Sofia" }),
    { tone: "waiting", label: "Aguardando" }
  )
  assert.deepEqual(
    resolveHeaderOwnershipView({ status: "human", assignedTo: "u1", currentUserId: "u1", agentName: "Sofia" }),
    { tone: "human", label: "Com você" }
  )
  assert.deepEqual(
    resolveHeaderOwnershipView({ status: "human", assignedTo: "u2", currentUserId: "u1", agentName: "Sofia" }),
    { tone: "human", label: "Operador" }
  )
  assert.deepEqual(
    resolveHeaderOwnershipView({ status: "closed", assignedTo: "u1", currentUserId: "u1", agentName: "Sofia" }),
    { tone: "closed", label: "Finalizado" }
  )
})

test("UI-03.2 Cenário 2: resolveReturnToAiLabel, formatConversationPhone e isHeaderActionLocked preservam contratos", () => {
  assert.equal(resolveReturnToAiLabel("Sofia"), "Devolver para Sofia")
  assert.equal(resolveReturnToAiLabel("IA"), "Devolver para IA")
  assert.equal(resolveReturnToAiLabel(null), "Devolver para IA")

  assert.equal(formatConversationPhone("5511988887777"), "+55 (11) 98888-7777")
  assert.equal(formatConversationPhone("551133334444"), "+55 (11) 3333-4444")
  assert.equal(formatConversationPhone("11988887777"), "(11) 98888-7777")
  assert.equal(formatConversationPhone(""), "")

  assert.equal(
    isHeaderActionLocked({ isTakingOver: false, isReturningToAI: false, isClosing: false, isReopening: false }),
    false
  )
  assert.equal(
    isHeaderActionLocked({ isTakingOver: true, isReturningToAI: false, isClosing: false, isReopening: false }),
    true
  )
  assert.equal(
    isHeaderActionLocked({ isTakingOver: false, isReturningToAI: false, isClosing: true, isReopening: false }),
    true
  )
})

test("UI-03.2 Cenário 3: Contratos estruturais de modularização, memoização, confirmação do servidor e alvos 44px", () => {
  const convDir = path.join(PROJECT_ROOT, "app", "(dashboard)", "conversations", "components")
  const painelSrc = fs.readFileSync(path.join(convDir, "painel-client.tsx"), "utf8")
  const headerSrc = fs.readFileSync(path.join(convDir, "conversation-header.tsx"), "utf8")
  const actionsSrc = fs.readFileSync(path.join(convDir, "conversation-header-actions.tsx"), "utf8")
  const ownershipSrc = fs.readFileSync(path.join(convDir, "conversation-ownership-controls.tsx"), "utf8")

  // Orquestrador delega cabeçalho sem duplicar subscriptions Realtime
  assert.ok(painelSrc.includes("<ConversationHeader"))
  for (const src of [headerSrc, actionsSrc, ownershipSrc]) {
    assert.equal(src.includes("createClient"), false, "Componentes de cabeçalho não podem criar subscriptions Realtime")
  }

  // Memoização e callbacks estáveis + bloqueio síncrono de ações concorrentes
  assert.ok(headerSrc.includes("React.memo(ConversationHeaderComponent)"))
  assert.ok(actionsSrc.includes("React.memo(ConversationHeaderActionsComponent)"))
  assert.ok(ownershipSrc.includes("React.memo(ConversationOwnershipControlsComponent)"))
  assert.match(painelSrc, /const handleTakeover = useCallback\(/)
  assert.match(painelSrc, /const handleReturnToAI = useCallback\(/)
  assert.match(painelSrc, /const handleCloseConversation = useCallback\(/)
  assert.match(painelSrc, /const handleReopenConversation = useCallback\(/)
  assert.match(painelSrc, /const handleChangeConversationStage = useCallback\(/)
  assert.ok(painelSrc.includes("lifecycleBusyRef.current"))
  assert.ok(painelSrc.includes("stageChangingRef.current"))

  // Sem mutação otimista prematura na troca de etapa (só atualiza após res.success)
  assert.equal(painelSrc.includes("Atualização otimista local"), false)

  // Alvos de toque >= 44px e tokens UI-02 preservados
  assert.ok(headerSrc.includes("h-11 w-11"))
  assert.ok(ownershipSrc.includes("min-h-[44px]"))
  assert.ok(actionsSrc.includes("h-11 w-11"))
  assert.ok(actionsSrc.includes("isHeaderActionLocked"))
  assert.ok(actionsSrc.includes("hidden 2xl:inline-flex"))

  for (const src of [headerSrc, actionsSrc, ownershipSrc]) {
    for (const forbidden of ["#005d4b", "#004738", "#efeae2", "#d9fdd3", "ellevee-note-"]) {
      assert.equal(src.includes(forbidden), false, `Módulo do cabeçalho contém token legado: ${forbidden}`)
    }
  }
})
