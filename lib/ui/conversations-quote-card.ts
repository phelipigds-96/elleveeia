export const COMPACT_DESKTOP_INSPECTOR_MIN_WIDTH_PX = 1360

export interface ParsedQuoteCardItem {
  indexLabel: string
  name: string
  quantityLine: string
  unitPriceLabel?: string
  subtotalLabel?: string
  pendingReason?: string
  isPending: boolean
}

export interface ParsedCommercialQuote {
  introText?: string
  validityLabel?: string
  versionLabel?: string
  items: ParsedQuoteCardItem[]
  totalLabel: string
  warningText?: string
  footerNote?: string
  outroText?: string
}

/**
 * Em desktops compactos (< 1360px, ex.: 1024px–1280px), mantém o inspector
 * recolhido inicialmente para priorizar a largura útil do diálogo.
 */
export function shouldAutoOpenInspector(viewportWidth: number): boolean {
  return Number.isFinite(viewportWidth) && viewportWidth >= COMPACT_DESKTOP_INSPECTOR_MIN_WIDTH_PX
}

/**
 * Evita redundâncias visuais como "IA ativa · IA" quando o nome do agente
 * estiver ausente ou for apenas um rótulo genérico de IA.
 */
export function resolveAiStatusDetail(agentName?: string | null): string | undefined {
  const normalized = (agentName || "").trim()
  if (!normalized) return undefined
  if (/^(ia|ai|ia ativa|agente|agente ia|bot)$/i.test(normalized)) {
    return undefined
  }
  return normalized
}

/**
 * Extrai dados estruturados de mensagens reais geradas por `formatQuoteForWhatsApp`
 * sem modificar, omitir ou inventar produtos, quantidades, preços ou totais.
 *
 * Regras de segurança / fallback:
 * - Preserva texto anterior (`introText`), observação padrão (`footerNote`) e texto posterior (`outroText`).
 * - Qualquer linha não reconhecida dentro do corpo do orçamento ou item incompleto retorna `null`,
 *   garantindo fallback integral para o texto original da mensagem.
 */
export function parseCommercialQuoteText(rawText: string | null | undefined): ParsedCommercialQuote | null {
  if (!rawText || typeof rawText !== "string") return null
  if (!rawText.includes("ORÇAMENTO COMERCIAL") || !rawText.includes("Total Confirmado:")) {
    return null
  }

  const rawLines = rawText.split(/\r?\n/)
  const headerIdx = rawLines.findIndex((l) => l.includes("ORÇAMENTO COMERCIAL"))
  if (headerIdx === -1) return null

  const introLines = rawLines.slice(0, headerIdx)
  const bodyLines = rawLines.slice(headerIdx + 1)

  let validityLabel: string | undefined
  let versionLabel: string | undefined
  let totalLabel = ""
  let warningText: string | undefined
  let footerNote: string | undefined
  const outroLines: string[] = []
  const items: ParsedQuoteCardItem[] = []
  let currentItem: ParsedQuoteCardItem | null = null
  let seenTotal = false

  for (const rawLine of bodyLines) {
    const line = rawLine.trim()
    if (!line) {
      if (seenTotal && outroLines.length > 0) outroLines.push("")
      continue
    }

    if (!seenTotal) {
      const validityMatch = line.match(/^_?Validade da proposta:\s*([^_]+?)_?(?:\s*\((v\d+)\))?$/i)
      if (validityMatch) {
        validityLabel = validityMatch[1].trim()
        if (validityMatch[2]) versionLabel = validityMatch[2].trim()
        continue
      }

      if (/^(?:🛒\s*)?\*?Itens do Orçamento:\*?$/i.test(line)) {
        continue
      }

      if (/^[━─—-]{5,}$/.test(line)) {
        continue
      }

      const itemHeaderMatch = line.match(/^(\d+)\.\s+\*([^*]+)\*$/)
      if (itemHeaderMatch) {
        if (currentItem) items.push(currentItem)
        currentItem = {
          indexLabel: `${itemHeaderMatch[1]}.`,
          name: itemHeaderMatch[2].trim(),
          quantityLine: "",
          isPending: false,
        }
        continue
      }

      if (currentItem && /^•\s*Qtd:/i.test(line)) {
        currentItem.quantityLine = line.replace(/^•\s*Qtd:\s*/i, "").trim()
        continue
      }

      if (currentItem && /^⏳\s*Qtd:/i.test(line)) {
        currentItem.isPending = true
        const stripped = line.replace(/^⏳\s*Qtd:\s*/i, "")
        const dashIdx = stripped.indexOf("—")
        if (dashIdx >= 0) {
          currentItem.quantityLine = stripped.slice(0, dashIdx).trim()
          const rawReason = stripped.slice(dashIdx + 1).trim().replace(/^_+|_+$/g, "").trim()
          if (rawReason) currentItem.pendingReason = rawReason
        } else {
          currentItem.quantityLine = stripped.trim()
        }
        continue
      }

      if (currentItem && /^•\s*/.test(line) && line.includes("Subtotal:")) {
        const priceAndSub = line.match(/^•\s*([^|]+?)\s*\|\s*Subtotal:\s*\*?([^*\n]+?)\*?$/i)
        if (!priceAndSub) return null
        currentItem.unitPriceLabel = priceAndSub[1].trim()
        currentItem.subtotalLabel = priceAndSub[2].trim()
        continue
      }

      const totalMatch = line.match(/^(?:💰\s*)?\*?Total Confirmado:\*?\s*\*?([^*\n]+?)\*?$/i)
      if (totalMatch) {
        if (currentItem) {
          items.push(currentItem)
          currentItem = null
        }
        totalLabel = totalMatch[1].replace(/\*/g, "").trim()
        seenTotal = true
        continue
      }

      // Qualquer linha desconhecida dentro do corpo do orçamento força fallback integral para o texto bruto
      return null
    }

    // Linhas posteriores ao Total Confirmado
    if (!warningText && (line.includes("Atenção:*") || line.includes("validação comercial humana"))) {
      warningText = line.replace(/^⚠️\s*/, "").replace(/\*/g, "").trim()
      continue
    }

    if (!footerNote && /^ℹ️\s*/.test(line)) {
      footerNote = line.replace(/^ℹ️\s*/, "").replace(/_/g, "").trim()
      continue
    }

    outroLines.push(rawLine)
  }

  if (currentItem) {
    items.push(currentItem)
  }

  if (items.length === 0 || !totalLabel) {
    return null
  }

  // Garantir integridade: todo item precisa de nome + quantidade; item confirmado precisa de subtotal
  for (const item of items) {
    if (!item.name || !item.quantityLine) return null
    if (!item.isPending && !item.subtotalLabel) return null
  }

  const introText = introLines.join("\n").trim() || undefined
  const outroText = outroLines.join("\n").trim() || undefined

  return {
    introText,
    validityLabel,
    versionLabel,
    items,
    totalLabel,
    warningText,
    footerNote,
    outroText,
  }
}
