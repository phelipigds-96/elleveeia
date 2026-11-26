import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

import {
  COMPACT_DESKTOP_INSPECTOR_MIN_WIDTH_PX,
  parseCommercialQuoteText,
  resolveAiStatusDetail,
  shouldAutoOpenInspector,
} from "../../lib/ui/conversations-quote-card"

const PROJECT_ROOT = process.cwd()

test("UI-02 Cenário 1: Inspector abre por padrão apenas em desktops >= 1360px", () => {
  assert.equal(COMPACT_DESKTOP_INSPECTOR_MIN_WIDTH_PX, 1360)
  assert.equal(shouldAutoOpenInspector(360), false)
  assert.equal(shouldAutoOpenInspector(1024), false)
  assert.equal(shouldAutoOpenInspector(1280), false)
  assert.equal(shouldAutoOpenInspector(1359), false)
  assert.equal(shouldAutoOpenInspector(1360), true)
  assert.equal(shouldAutoOpenInspector(1440), true)
})

test("UI-02 Cenário 2: parseCommercialQuoteText preserva fielmente saída real de formatQuoteForWhatsApp sem alterar nem inventar dados", () => {
  const sampleQuote = [
    "Segue o resumo atualizado do seu pedido:",
    "",
    "📋 *ORÇAMENTO COMERCIAL* — Ellevee IA",
    "_Validade da proposta: até 30/11/2026_ (v2)",
    "",
    "🛒 *Itens do Orçamento:*",
    "1. *Leite Condensado Integral Piracanjuba Lata 395g Pack Atacado Corporativo*",
    "   • Qtd: 54 un (2 cx c/ 27 un = 54 un) (Atacado)",
    "   • R$ 5,80 un | Subtotal: *R$ 313,20*",
    "2. *Leite UHT Integral 1L Longa Vida*",
    "   ⏳ Qtd: 12 un — _Preço pendente de confirmação_",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "💰 *Total Confirmado:* *R$ 313,20*",
    "",
    "⚠️ *Atenção:* Alguns itens requerem validação comercial humana e não estão incluídos no total acima.",
    "",
    "ℹ️ _Esta proposta é válida por tempo limitado e não reserva estoque._",
    "",
    "Se quiser fechar o pedido, me avise.",
  ].join("\n")

  const parsed = parseCommercialQuoteText(sampleQuote)
  assert.ok(parsed, "Deveria estruturar orçamento formatado por formatQuoteForWhatsApp")
  assert.equal(parsed.introText, "Segue o resumo atualizado do seu pedido:")
  assert.equal(parsed.validityLabel, "até 30/11/2026")
  assert.equal(parsed.versionLabel, "v2")
  assert.equal(parsed.items.length, 2)
  assert.equal(parsed.items[0].indexLabel, "1.")
  assert.equal(
    parsed.items[0].name,
    "Leite Condensado Integral Piracanjuba Lata 395g Pack Atacado Corporativo"
  )
  assert.equal(parsed.items[0].quantityLine, "54 un (2 cx c/ 27 un = 54 un) (Atacado)")
  assert.equal(parsed.items[0].unitPriceLabel, "R$ 5,80 un")
  assert.equal(parsed.items[0].subtotalLabel, "R$ 313,20")
  assert.equal(parsed.items[0].isPending, false)
  assert.equal(parsed.items[1].indexLabel, "2.")
  assert.equal(parsed.items[1].isPending, true)
  assert.equal(parsed.items[1].quantityLine, "12 un")
  assert.equal(parsed.items[1].pendingReason, "Preço pendente de confirmação")
  assert.equal(parsed.totalLabel, "R$ 313,20")
  assert.equal(
    parsed.warningText,
    "Atenção: Alguns itens requerem validação comercial humana e não estão incluídos no total acima."
  )
  assert.equal(parsed.footerNote, "Esta proposta é válida por tempo limitado e não reserva estoque.")
  assert.equal(parsed.outroText, "Se quiser fechar o pedido, me avise.")
})

test("UI-02 Cenário 3: parseCommercialQuoteText não inventa motivo pendente quando ausente na mensagem", () => {
  const quoteWithoutReason = [
    "📋 *ORÇAMENTO COMERCIAL* — Ellevee IA",
    "1. *Produto Sob Consulta*",
    "   ⏳ Qtd: 5 cx",
    "💰 *Total Confirmado:* *R$ 0,00*",
  ].join("\n")

  const parsed = parseCommercialQuoteText(quoteWithoutReason)
  assert.ok(parsed)
  assert.equal(parsed.items[0].isPending, true)
  assert.equal(parsed.items[0].quantityLine, "5 cx")
  assert.equal(parsed.items[0].pendingReason, undefined)
})

test("UI-02 Cenário 4: parseCommercialQuoteText retorna null (fallback para texto bruto) quando houver linhas incompatíveis ou incompletas", () => {
  assert.equal(parseCommercialQuoteText("Oi, tudo bem? Como posso ajudar hoje?"), null)
  assert.equal(
    parseCommercialQuoteText("Varejo: R$ 4,80 por unidade (1 a 11). Atacado: R$ 4,20 a partir de 12."),
    null
  )
  assert.equal(parseCommercialQuoteText(""), null)
  assert.equal(parseCommercialQuoteText(null), null)

  // Linha extra desconhecida dentro do corpo do orçamento -> NÃO pode omitir dados; deve cair em fallback
  const quoteWithUnknownLine = [
    "📋 *ORÇAMENTO COMERCIAL* — Ellevee IA",
    "1. *Leite UHT Integral 1L*",
    "   • Qtd: 12 un",
    "   • R$ 4,20 un | Subtotal: *R$ 50,40*",
    "Frete estimado: R$ 25,00",
    "💰 *Total Confirmado:* *R$ 50,40*",
  ].join("\n")
  assert.equal(parseCommercialQuoteText(quoteWithUnknownLine), null)

  // Item confirmado sem subtotal -> fallback integral
  const incompleteQuote = [
    "📋 *ORÇAMENTO COMERCIAL* — Ellevee IA",
    "1. *Leite UHT Integral 1L*",
    "   • Qtd: 12 un",
    "💰 *Total Confirmado:* *R$ 50,40*",
  ].join("\n")
  assert.equal(parseCommercialQuoteText(incompleteQuote), null)
})

test("UI-02 Cenário 5: resolveAiStatusDetail elimina redundâncias como 'IA ativa · IA' preservando nomes reais de agentes", () => {
  assert.equal(resolveAiStatusDetail(null), undefined)
  assert.equal(resolveAiStatusDetail(undefined), undefined)
  assert.equal(resolveAiStatusDetail(""), undefined)
  assert.equal(resolveAiStatusDetail("IA"), undefined)
  assert.equal(resolveAiStatusDetail("ia"), undefined)
  assert.equal(resolveAiStatusDetail("IA ativa"), undefined)
  assert.equal(resolveAiStatusDetail("Agente IA"), undefined)
  assert.equal(resolveAiStatusDetail("Sofia"), "Sofia")
  assert.equal(resolveAiStatusDetail("Sofia IA"), "Sofia IA")
  assert.equal(resolveAiStatusDetail("Agente Comercial B2B"), "Agente Comercial B2B")
})

test("UI-02 Cenário 6: Taxonomia Fluent/Ellevee de status preserva estados operacionais e bloqueia detalhe redundante no StatusChip", () => {
  const statusPath = path.join(PROJECT_ROOT, "components", "conversations", "conversation-status.tsx")
  const statusSrc = fs.readFileSync(statusPath, "utf8")

  assert.match(statusSrc, /waiting:\s*\{[\s\S]*label:\s*"Aguardando"/)
  assert.match(statusSrc, /in_progress:\s*\{[\s\S]*label:\s*"Com operador"/)
  assert.match(statusSrc, /ai:\s*\{[\s\S]*label:\s*"IA ativa"/)
  assert.match(statusSrc, /closed:\s*\{[\s\S]*label:\s*"Finalizado"/)
  assert.ok(statusSrc.includes('if (status === "human") return assigned ? VIEWS.in_progress : VIEWS.waiting'))
  assert.ok(statusSrc.includes('if (status === "closed") return VIEWS.closed'))
  assert.ok(statusSrc.includes("isRedundantDetail"), "StatusChip deve suprimir detail redundante como 'IA ativa · IA'")
})

test("UI-02 Cenário 7: Painel funcional e shell removem paleta WhatsApp legada e classes quebradas", () => {
  const componentsDir = path.join(PROJECT_ROOT, "app", "(dashboard)", "conversations", "components")
  const componentFiles = fs
    .readdirSync(componentsDir)
    .filter((f) => f.endsWith(".tsx"))
    .sort()
  const conversationsSrc = componentFiles
    .map((f) => fs.readFileSync(path.join(componentsDir, f), "utf8"))
    .join("\n")
  const shellPath = path.join(PROJECT_ROOT, "components", "layout", "dashboard-shell.tsx")
  const cssPath = path.join(PROJECT_ROOT, "app", "globals.css")

  const shellSrc = fs.readFileSync(shellPath, "utf8")
  const cssSrc = fs.readFileSync(cssPath, "utf8")

  for (const forbidden of ["#005d4b", "#004738", "#efeae2", "#d9fdd3", "ellevee-note-"]) {
    assert.equal(
      conversationsSrc.includes(forbidden),
      false,
      `componentes de /conversations ainda contêm classe/cor legada: ${forbidden}`
    )
    assert.equal(
      shellSrc.includes(forbidden),
      false,
      `dashboard-shell.tsx ainda contém classe/cor legada: ${forbidden}`
    )
    assert.equal(
      cssSrc.includes(forbidden),
      false,
      `globals.css ainda contém classe/cor legada: ${forbidden}`
    )
  }

  assert.ok(conversationsSrc.includes("line-clamp-2"), "Cartões de orçamento devem suportar 2 linhas no nome do produto")
  assert.ok(conversationsSrc.includes("shouldAutoOpenInspector"), "Desktop compacto deve usar regra shouldAutoOpenInspector")
  assert.ok(conversationsSrc.includes("resolveAiStatusDetail"), "StatusChip deve usar resolveAiStatusDetail para evitar redundância")
  assert.ok(conversationsSrc.includes("bg-note-bg"), "Notas internas devem usar token note-bg do tailwind.config.ts")
  assert.ok(
    conversationsSrc.includes("calc(var(--ellevee-vvh,100dvh)-2.5rem)"),
    "Bottom sheet mobile deve respeitar altura dinâmica --ellevee-vvh com teclado aberto"
  )
})
