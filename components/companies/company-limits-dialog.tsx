"use client"

import React, { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sliders, Zap, Bot, MessageSquare, CheckCircle2 } from "lucide-react"
import { CompanyMock } from "./mock-companies"
import { updateCompanyLimitsAction } from "@/app/(admin)/companies/actions"
import { toast } from "@/components/ui/toast"

interface CompanyLimitsDialogProps {
  company: CompanyMock | null
  open: boolean
  onClose: () => void
  onSave?: (updated: CompanyMock) => void
}

export default function CompanyLimitsDialog({
  company,
  open,
  onClose,
  onSave,
}: CompanyLimitsDialogProps) {
  const router = useRouter()
  const [messagesLimit, setMessagesLimit] = useState<number>(0)
  const [tokensLimit, setTokensLimit] = useState<number>(0)
  const [maxAgents, setMaxAgents] = useState<number>(0)
  const [allowOpenAI, setAllowOpenAI] = useState(true)
  const [allowGemini, setAllowGemini] = useState(true)
  const [allowAnthropic, setAllowAnthropic] = useState(false)
  const [requireCloseReason, setRequireCloseReason] = useState(false)
  const [customAddonPriceInput, setCustomAddonPriceInput] = useState<string>("")
  const [customOveragePriceInput, setCustomOveragePriceInput] = useState<string>("")
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (company) {
      setMessagesLimit(company.messagesLimit)
      setTokensLimit(company.tokensLimit)
      setMaxAgents(company.maxAgents)
      setAllowOpenAI(company.aiProvider === "openai" || company.aiProvider === "hybrid")
      setAllowGemini(company.aiProvider === "gemini" || company.aiProvider === "hybrid")
      setAllowAnthropic(false)
      setRequireCloseReason(Boolean(company.requireCloseReason))
      setCustomAddonPriceInput(
        company.addonUnitPriceBrl !== undefined ? String(company.addonUnitPriceBrl) : ""
      )
      setCustomOveragePriceInput(
        company.overageUnitPriceBrl !== undefined ? String(company.overageUnitPriceBrl) : ""
      )
    }
  }, [company])

  if (!company) return null

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const allowedProviders: string[] = []
      if (allowOpenAI) allowedProviders.push("openai")
      if (allowGemini) allowedProviders.push("gemini")
      if (allowAnthropic) allowedProviders.push("anthropic")
      if (allowedProviders.length === 0) allowedProviders.push("gemini")

      const parsedAddonPrice =
        customAddonPriceInput.trim() === "" ? null : Math.max(0, Number(customAddonPriceInput) || 0)
      const parsedOveragePrice =
        customOveragePriceInput.trim() === "" ? null : Math.max(0, Number(customOveragePriceInput) || 0)

      const result = await updateCompanyLimitsAction(company.id, {
        maxMonthlyMessages: messagesLimit,
        maxAgents: maxAgents,
        allowedLlmProviders: allowedProviders,
        tokensLimit: tokensLimit,
        requireCloseReason,
        customAddonUnitPriceBrl: parsedAddonPrice,
        customOverageUnitPriceBrl: parsedOveragePrice,
      })

      if (result.success) {
        toast.success(
          "Limites atualizados com sucesso",
          `Cotas de infraestrutura de ${company.name} configuradas com sucesso.`
        )

        let providerUI: "openai" | "gemini" | "hybrid" = "gemini"
        if (allowOpenAI && allowGemini) providerUI = "hybrid"
        else if (allowOpenAI) providerUI = "openai"
        else providerUI = "gemini"

        if (onSave) {
          onSave({
            ...company,
            messagesLimit,
            tokensLimit,
            maxAgents,
            aiProvider: providerUI,
            requireCloseReason,
            addonUnitPriceBrl: parsedAddonPrice ?? company.addonUnitPriceBrl,
            overageUnitPriceBrl: parsedOveragePrice ?? company.overageUnitPriceBrl,
          })
        }

        router.refresh()
        onClose()
      } else {
        toast.error("Falha ao salvar limites", result.error || "Ocorreu um erro no servidor.")
      }
    } catch (err: any) {
      toast.error("Erro inesperado", err.message || "Falha na comunicação com o servidor.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-ellevee-warm-ivory border border-ellevee-border text-ellevee-deep-ink flex items-center justify-center">
            <Sliders className="h-4 w-4 text-ellevee-cyan" />
          </div>
          <div>
            <DialogTitle className="font-display text-base font-bold text-ellevee-deep-ink">Ajustar Limites de Infraestrutura</DialogTitle>
            <DialogDescription className="text-xs text-ellevee-text-secondary">
              Configuração fina de cotas para <span className="font-semibold text-ellevee-deep-ink">{company.name}</span>
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {/* Limite de Mensagens */}
        <div className="rounded-xl border border-ellevee-border p-3.5 bg-[#F8F8F6] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-ellevee-deep-ink">
              <MessageSquare className="h-3.5 w-3.5 text-ellevee-text-secondary" />
              <span>Limite Mensal de Mensagens</span>
            </div>
            <span className="text-xs font-mono text-ellevee-text-secondary">
              Consumo: {company.messagesUsed.toLocaleString()} msgs
            </span>
          </div>
          <Input
            type="number"
            value={messagesLimit}
            onChange={(e) => setMessagesLimit(Number(e.target.value))}
            className="bg-white font-mono text-xs border-ellevee-border text-ellevee-deep-ink"
            disabled={isSaving}
          />
          <p className="text-[11px] text-ellevee-text-secondary">
            Total de mensagens enviadas (IA + Humano) incluídas na franquia mensal sem pausa automática.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-ellevee-border">
            <div>
              <label className="text-[10px] font-medium text-ellevee-text-secondary block mb-1">
                Tarifa Bloco Extra (R$/msg env.)
              </label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Padrão do plano (0.04)"
                value={customAddonPriceInput}
                onChange={(e) => setCustomAddonPriceInput(e.target.value)}
                className="bg-white font-mono text-xs h-8 border-ellevee-border text-ellevee-deep-ink"
                disabled={isSaving}
              />
            </div>
            <div>
              <label className="text-[10px] font-medium text-ellevee-text-secondary block mb-1">
                Tarifa Avulso Excedente (R$/msg env.)
              </label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Padrão do plano (0.07)"
                value={customOveragePriceInput}
                onChange={(e) => setCustomOveragePriceInput(e.target.value)}
                className="bg-white font-mono text-xs h-8 border-ellevee-border text-ellevee-deep-ink"
                disabled={isSaving}
              />
            </div>
          </div>
        </div>

        {/* Limite de Tokens */}
        <div className="rounded-xl border border-ellevee-border p-3.5 bg-[#F8F8F6] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-ellevee-deep-ink">
              <Zap className="h-3.5 w-3.5 text-ellevee-text-secondary" />
              <span>Limite de Tokens de IA (Mensal)</span>
            </div>
            <span className="text-xs font-mono text-ellevee-text-secondary">
              Consumo: {company.tokensUsed.toLocaleString()} tokens
            </span>
          </div>
          <Input
            type="number"
            value={tokensLimit}
            onChange={(e) => setTokensLimit(Number(e.target.value))}
            className="bg-white font-mono text-xs border-ellevee-border text-ellevee-deep-ink"
            disabled={isSaving}
          />
          <p className="text-[11px] text-ellevee-text-secondary">
            Cota de tokens consumidos em chamadas ao Agent Engine e inferência de modelos.
          </p>
        </div>

        {/* Quantidade de Agentes */}
        <div className="rounded-xl border border-ellevee-border p-3.5 bg-[#F8F8F6] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-ellevee-deep-ink">
              <Bot className="h-3.5 w-3.5 text-ellevee-text-secondary" />
              <span>Máximo de Agentes Ativos Simultâneos</span>
            </div>
            <span className="text-xs font-mono text-ellevee-text-secondary">
              Ativos: {company.agentsCount} / {company.maxAgents}
            </span>
          </div>
          <Input
            type="number"
            value={maxAgents}
            onChange={(e) => setMaxAgents(Number(e.target.value))}
            className="bg-white font-mono text-xs border-ellevee-border text-ellevee-deep-ink"
            disabled={isSaving}
          />
          <p className="text-[11px] text-ellevee-text-secondary">
            Número de bots especializados ou instâncias simultâneas no catálogo do tenant.
          </p>
        </div>

        {/* Provedores Permitidos */}
        <div className="pt-1">
          <label className="block text-xs font-semibold text-ellevee-deep-ink mb-2">
            Provedores de LLM Permitidos para esta Empresa:
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex items-center gap-2 p-2.5 rounded-lg border border-ellevee-border bg-white hover:bg-ellevee-warm-ivory/50 cursor-pointer text-xs font-medium text-ellevee-deep-ink">
              <input
                type="checkbox"
                checked={allowOpenAI}
                onChange={(e) => setAllowOpenAI(e.target.checked)}
                className="rounded border-ellevee-border text-ellevee-deep-ink focus:ring-ellevee-blue"
                disabled={isSaving}
              />
              OpenAI
            </label>
            <label className="flex items-center gap-2 p-2.5 rounded-lg border border-ellevee-border bg-white hover:bg-ellevee-warm-ivory/50 cursor-pointer text-xs font-medium text-ellevee-deep-ink">
              <input
                type="checkbox"
                checked={allowGemini}
                onChange={(e) => setAllowGemini(e.target.checked)}
                className="rounded border-ellevee-border text-ellevee-deep-ink focus:ring-ellevee-blue"
                disabled={isSaving}
              />
              Google Gemini
            </label>
            <label className="flex items-center gap-2 p-2.5 rounded-lg border border-ellevee-border bg-white hover:bg-ellevee-warm-ivory/50 cursor-pointer text-xs font-medium text-ellevee-deep-ink">
              <input
                type="checkbox"
                checked={allowAnthropic}
                onChange={(e) => setAllowAnthropic(e.target.checked)}
                className="rounded border-ellevee-border text-ellevee-deep-ink focus:ring-ellevee-blue"
                disabled={isSaving}
              />
              Anthropic
            </label>
          </div>
        </div>

        {/* Política de Atendimento & Governança */}
        <div className="rounded-xl border border-ellevee-border p-3.5 bg-[#F8F8F6] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-ellevee-deep-ink">
              <CheckCircle2 className="h-3.5 w-3.5 text-ellevee-purple" />
              <span>Exigir Motivo de Finalização de Atendimento</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={requireCloseReason}
                onChange={(e) => setRequireCloseReason(e.target.checked)}
                className="sr-only peer"
                disabled={isSaving}
              />
              <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-ellevee-purple"></div>
            </label>
          </div>
          <p className="text-[11px] text-ellevee-text-secondary">
            Quando ativo, os atendentes desta empresa são obrigados a escolher um motivo cadastrado para concluir qualquer conversa no chat.
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isSaving} className="border-ellevee-border text-ellevee-deep-ink">
          Cancelar
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Salvando..." : "Salvar Alterações de Limites"}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
