"use client"

import React, { useState, useEffect } from "react"
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sliders, Zap, Bot, MessageSquare, Check, Sparkles } from "lucide-react"
import { CompanyMock } from "./mock-companies"

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
  const [messagesLimit, setMessagesLimit] = useState<number>(0)
  const [tokensLimit, setTokensLimit] = useState<number>(0)
  const [maxAgents, setMaxAgents] = useState<number>(0)
  const [allowOpenAI, setAllowOpenAI] = useState(true)
  const [allowGemini, setAllowGemini] = useState(true)
  const [allowAnthropic, setAllowAnthropic] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (company) {
      setMessagesLimit(company.messagesLimit)
      setTokensLimit(company.tokensLimit)
      setMaxAgents(company.maxAgents)
      setAllowOpenAI(company.aiProvider === "openai" || company.aiProvider === "hybrid")
      setAllowGemini(company.aiProvider === "gemini" || company.aiProvider === "hybrid")
      setAllowAnthropic(false)
    }
  }, [company])

  if (!company) return null

  const handleSave = () => {
    setIsSaving(true)
    setTimeout(() => {
      setIsSaving(false)
      if (onSave) {
        onSave({
          ...company,
          messagesLimit,
          tokensLimit,
          maxAgents,
        })
      }
      onClose()
    }, 500)
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-md bg-[#F3F2ED] border border-ellevee-stone text-ellevee-ink flex items-center justify-center">
            <Sliders className="h-4 w-4" />
          </div>
          <div>
            <DialogTitle>Ajustar Limites de Infraestrutura</DialogTitle>
            <DialogDescription>
              Configuração fina de cotas para <span className="font-semibold text-ellevee-ink">{company.name}</span>
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {/* Limite de Mensagens */}
        <div className="rounded-lg border border-ellevee-stone p-3.5 bg-[#FBFBFA] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-ellevee-ink">
              <MessageSquare className="h-3.5 w-3.5 text-ellevee-sage" />
              <span>Limite Mensal de Mensagens</span>
            </div>
            <span className="text-xs font-mono text-ellevee-sage">
              Consumo: {company.messagesUsed.toLocaleString()} msgs
            </span>
          </div>
          <Input
            type="number"
            value={messagesLimit}
            onChange={(e) => setMessagesLimit(Number(e.target.value))}
            className="bg-white font-mono text-xs"
          />
          <p className="text-[11px] text-ellevee-sage">
            Total de mensagens que o motor de atendimento (humano e IA) pode transacionar por mês.
          </p>
        </div>

        {/* Limite de Tokens */}
        <div className="rounded-lg border border-ellevee-stone p-3.5 bg-[#FBFBFA] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-ellevee-ink">
              <Zap className="h-3.5 w-3.5 text-ellevee-sage" />
              <span>Limite de Tokens de IA (Mensal)</span>
            </div>
            <span className="text-xs font-mono text-ellevee-sage">
              Consumo: {company.tokensUsed.toLocaleString()} tokens
            </span>
          </div>
          <Input
            type="number"
            value={tokensLimit}
            onChange={(e) => setTokensLimit(Number(e.target.value))}
            className="bg-white font-mono text-xs"
          />
          <p className="text-[11px] text-ellevee-sage">
            Cota de tokens consumidos em chamadas ao Agent Engine e inferência de modelos.
          </p>
        </div>

        {/* Quantidade de Agentes */}
        <div className="rounded-lg border border-ellevee-stone p-3.5 bg-[#FBFBFA] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-ellevee-ink">
              <Bot className="h-3.5 w-3.5 text-ellevee-sage" />
              <span>Máximo de Agentes Ativos Simultâneos</span>
            </div>
            <span className="text-xs font-mono text-ellevee-sage">
              Ativos: {company.agentsCount} / {company.maxAgents}
            </span>
          </div>
          <Input
            type="number"
            value={maxAgents}
            onChange={(e) => setMaxAgents(Number(e.target.value))}
            className="bg-white font-mono text-xs"
          />
          <p className="text-[11px] text-ellevee-sage">
            Número de bots especializados ou instâncias simultâneas no catálogo do tenant.
          </p>
        </div>

        {/* Provedores Permitidos */}
        <div className="pt-1">
          <label className="block text-xs font-semibold text-ellevee-ink mb-2">
            Provedores de LLM Permitidos para esta Empresa:
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex items-center gap-2 p-2.5 rounded-md border border-ellevee-stone bg-white hover:bg-[#F8F8F5] cursor-pointer text-xs font-medium text-ellevee-ink">
              <input
                type="checkbox"
                checked={allowOpenAI}
                onChange={(e) => setAllowOpenAI(e.target.checked)}
                className="rounded border-ellevee-stone text-ellevee-ink focus:ring-ellevee-ink"
              />
              OpenAI
            </label>
            <label className="flex items-center gap-2 p-2.5 rounded-md border border-ellevee-stone bg-white hover:bg-[#F8F8F5] cursor-pointer text-xs font-medium text-ellevee-ink">
              <input
                type="checkbox"
                checked={allowGemini}
                onChange={(e) => setAllowGemini(e.target.checked)}
                className="rounded border-ellevee-stone text-ellevee-ink focus:ring-ellevee-ink"
              />
              Google Gemini
            </label>
            <label className="flex items-center gap-2 p-2.5 rounded-md border border-ellevee-stone bg-white hover:bg-[#F8F8F5] cursor-pointer text-xs font-medium text-ellevee-ink">
              <input
                type="checkbox"
                checked={allowAnthropic}
                onChange={(e) => setAllowAnthropic(e.target.checked)}
                className="rounded border-ellevee-stone text-ellevee-ink focus:ring-ellevee-ink"
              />
              Anthropic
            </label>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isSaving}>
          Cancelar
        </Button>
        <Button variant="default" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Salvando..." : "Salvar Alterações de Limites"}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
