"use client"

import React, { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Layers, Bot, MessageSquare, Database, Sparkles, Check, AlertCircle } from "lucide-react"
import { PlatformPlan } from "@/lib/services/platform/plans"
import { updatePlatformPlanAction } from "@/app/(admin)/plans/actions"
import { toast } from "@/components/ui/toast"

interface PlanEditDialogProps {
  plan: PlatformPlan | null
  open: boolean
  onClose: () => void
  onSave?: (updatedPlan: PlatformPlan) => void
}

export default function PlanEditDialog({
  plan,
  open,
  onClose,
  onSave,
}: PlanEditDialogProps) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [priceMonthly, setPriceMonthly] = useState<number>(0)
  const [maxMonthlyMessages, setMaxMonthlyMessages] = useState<number>(5000)
  const [maxAgents, setMaxAgents] = useState<number>(1)
  const [maxCatalogItems, setMaxCatalogItems] = useState<number>(10000)
  const [maxMonthlyQuotes, setMaxMonthlyQuotes] = useState<number>(1000)
  const [addonPackageUnitPriceBrl, setAddonPackageUnitPriceBrl] = useState<number>(0.04)
  const [overageUnitPriceBrl, setOverageUnitPriceBrl] = useState<number>(0.07)
  const [defaultAiProvider, setDefaultAiProvider] = useState<"openai" | "gemini" | "hybrid">("openai")
  const [defaultAiModel, setDefaultAiModel] = useState<string>("gpt-4o-mini")
  const [badge, setBadge] = useState<string>("")
  const [isPopular, setIsPopular] = useState<boolean>(false)
  const [featuresText, setFeaturesText] = useState<string>("")
  const [isSaving, setIsSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (plan) {
      setName(plan.name)
      setDescription(plan.description)
      setPriceMonthly(plan.priceMonthly)
      setMaxMonthlyMessages(plan.maxMonthlyMessages)
      setMaxAgents(plan.maxAgents)
      setMaxCatalogItems(plan.maxCatalogItems)
      setMaxMonthlyQuotes(plan.maxMonthlyQuotes)
      setAddonPackageUnitPriceBrl(
        plan.addonPackageUnitPriceBrl ?? (plan.key === "trial" ? 0 : 0.04)
      )
      setOverageUnitPriceBrl(
        plan.overageUnitPriceBrl ?? (plan.key === "trial" ? 0 : 0.07)
      )
      setDefaultAiProvider(plan.defaultAiProvider || "openai")
      setDefaultAiModel(plan.defaultAiModel || (plan.key === "pro" || plan.key === "enterprise" ? "gpt-4o" : "gpt-4o-mini"))
      setBadge(plan.badge || "")
      setIsPopular(plan.isPopular)
      setFeaturesText(plan.features.join("\n"))
      setErrorMsg(null)
    }
  }, [plan])

  if (!plan) return null

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setIsSaving(true)

    try {
      const parsedFeatures = featuresText
        .split("\n")
        .map((f) => f.trim())
        .filter((f) => f.length > 0)

      const allowedProviders = defaultAiProvider === "hybrid" ? ["openai", "gemini"] : [defaultAiProvider]

      const res = await updatePlatformPlanAction(plan.key, {
        name,
        description,
        priceMonthly: Number(priceMonthly),
        maxMonthlyMessages: Number(maxMonthlyMessages),
        maxAgents: Number(maxAgents),
        maxCatalogItems: Number(maxCatalogItems),
        maxMonthlyQuotes: Number(maxMonthlyQuotes),
        addonPackageUnitPriceBrl: Math.max(0, Number(addonPackageUnitPriceBrl) || 0),
        overageUnitPriceBrl: Math.max(0, Number(overageUnitPriceBrl) || 0),
        defaultAiProvider,
        defaultAiModel,
        allowedLlmProviders: allowedProviders,
        badge: badge.trim() || null,
        isPopular,
        features: parsedFeatures.length > 0 ? parsedFeatures : plan.features,
      })

      if (!res.success || !res.data) {
        setErrorMsg(res.error || "Falha ao salvar as alterações do plano.")
        toast.error("Erro ao atualizar plano", res.error || "Não foi possível persistir os novos parâmetros.")
        setIsSaving(false)
        return
      }

      toast.success(
        "Plano atualizado com sucesso",
        `Os parâmetros operacionais do plano ${res.data.name} foram sincronizados e auditados.`
      )

      if (onSave) {
        onSave(res.data)
      }

      setIsSaving(false)
      onClose()
      router.refresh()
    } catch (err: any) {
      setErrorMsg(err.message || "Erro inesperado ao salvar.")
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-ellevee-deep-ink text-white shadow-sm">
            <Layers className="w-5 h-5 text-ellevee-cyan" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <DialogTitle className="font-display text-lg text-ellevee-deep-ink">
                Editar Plano: {plan.name}
              </DialogTitle>
              <Badge variant="outline" className="text-[10px] uppercase font-mono tracking-wider border-ellevee-border text-ellevee-deep-ink bg-white">
                {plan.key}
              </Badge>
            </div>
            <DialogDescription className="text-xs text-ellevee-text-secondary">
              Defina as cotas, precificação mensal e infraestrutura de IA padrão aplicada aos tenants deste nível.
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <form onSubmit={handleSave} className="space-y-5 py-2">
        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Linha 1: Nome comercial, Preço e Destaque */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-[11px] font-semibold text-ellevee-deep-ink uppercase tracking-wider block mb-1">
              Nome do Plano
            </label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="text-xs h-9"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-ellevee-deep-ink uppercase tracking-wider block mb-1">
              Preço Mensal (R$)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-xs font-semibold text-ellevee-text-secondary">
                R$
              </span>
              <Input
                type="number"
                min="0"
                step="1"
                value={priceMonthly}
                onChange={(e) => setPriceMonthly(Number(e.target.value))}
                required
                className="pl-9 text-xs h-9 font-medium"
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-ellevee-deep-ink uppercase tracking-wider block mb-1">
              Badge Promocional
            </label>
            <Input
              type="text"
              placeholder="Ex: Mais Popular · Recomendado"
              value={badge}
              onChange={(e) => setBadge(e.target.value)}
              className="text-xs h-9"
            />
          </div>
        </div>

        {/* Linha 2: Descrição curta */}
        <div>
          <label className="text-[11px] font-semibold text-ellevee-deep-ink uppercase tracking-wider block mb-1">
            Descrição Operacional
          </label>
          <Input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="text-xs h-9"
          />
        </div>

        {/* Seção de Cotas Operacionais */}
        <div className="rounded-xl border border-ellevee-border bg-[#F8F8F6] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-ellevee-deep-ink" />
            <span className="text-xs font-bold text-ellevee-deep-ink uppercase tracking-wider font-display">
              Cotas e Limites de Volume
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-[11px] font-medium text-ellevee-text-secondary block mb-1">
                Msgs Mensais
              </label>
              <Input
                type="number"
                min="100"
                step="500"
                value={maxMonthlyMessages}
                onChange={(e) => setMaxMonthlyMessages(Number(e.target.value))}
                required
                className="text-xs h-9 bg-white"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-ellevee-text-secondary block mb-1">
                Máx. Agentes
              </label>
              <Input
                type="number"
                min="1"
                max="50"
                value={maxAgents}
                onChange={(e) => setMaxAgents(Number(e.target.value))}
                required
                className="text-xs h-9 bg-white"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-ellevee-text-secondary block mb-1">
                Itens no Catálogo
              </label>
              <Input
                type="number"
                min="0"
                step="1000"
                value={maxCatalogItems}
                onChange={(e) => setMaxCatalogItems(Number(e.target.value))}
                required
                className="text-xs h-9 bg-white"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-ellevee-text-secondary block mb-1">
                Orçamentos / Mês
              </label>
              <Input
                type="number"
                min="0"
                step="100"
                value={maxMonthlyQuotes}
                onChange={(e) => setMaxMonthlyQuotes(Number(e.target.value))}
                required
                className="text-xs h-9 bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-ellevee-border">
            <div>
              <label className="text-[11px] font-medium text-ellevee-text-secondary block mb-1">
                Tarifa Bloco Extra (R$/msg env.)
              </label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={addonPackageUnitPriceBrl}
                onChange={(e) => setAddonPackageUnitPriceBrl(Number(e.target.value))}
                className="text-xs h-9 bg-white font-mono"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-ellevee-text-secondary block mb-1">
                Tarifa Excedente Avulso (R$/msg env.)
              </label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={overageUnitPriceBrl}
                onChange={(e) => setOverageUnitPriceBrl(Number(e.target.value))}
                className="text-xs h-9 bg-white font-mono"
              />
            </div>
          </div>
        </div>

        {/* Seção de Inteligência Artificial — Foco OpenAI */}
        <div className="rounded-xl border border-emerald-900/10 bg-emerald-50/40 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-ellevee-purple" />
              <span className="text-xs font-bold text-ellevee-deep-ink uppercase tracking-wider font-display">
                Infraestrutura de IA Padrão (OpenAI)
              </span>
            </div>
            <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded-full border border-emerald-200">
              Provider Recomendado
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-ellevee-deep-ink block mb-1">
                Provedor de LLM Primário
              </label>
              <Select
                value={defaultAiProvider}
                onChange={(e) => setDefaultAiProvider(e.target.value as any)}
                className="bg-white"
              >
                <option value="openai">OpenAI (Nativo · Recomendado Produção)</option>
                <option value="gemini">Google Gemini</option>
                <option value="hybrid">Híbrido (OpenAI + Gemini)</option>
              </Select>
            </div>

            <div>
              <label className="text-[11px] font-medium text-ellevee-deep-ink block mb-1">
                Modelo Padrão Recomendado
              </label>
              <Select
                value={defaultAiModel}
                onChange={(e) => setDefaultAiModel(e.target.value)}
                className="bg-white"
              >
                <option value="gpt-4o-mini">OpenAI GPT-4o Mini (Alta velocidade & baixo custo)</option>
                <option value="gpt-4o">OpenAI GPT-4o (Raciocínio complexo & multimodal)</option>
                <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
              </Select>
            </div>
          </div>
          <p className="text-[11px] text-ellevee-text-secondary leading-relaxed">
            * Todas as novas organizações provisionadas com este plano herdarão OpenAI como motor cognitivo prioritário.
          </p>
        </div>

        {/* Recursos / Itens de Checklist */}
        <div>
          <label className="text-[11px] font-semibold text-ellevee-deep-ink uppercase tracking-wider block mb-1">
            Recursos Incluídos (um item por linha)
          </label>
          <textarea
            rows={4}
            value={featuresText}
            onChange={(e) => setFeaturesText(e.target.value)}
            className="w-full rounded-lg border border-ellevee-border bg-white p-3 text-xs text-ellevee-deep-ink shadow-2xs focus:outline-none focus:ring-1 focus:ring-ellevee-blue leading-relaxed font-sans placeholder:text-ellevee-text-secondary/60"
            placeholder="Ex: 5.000 mensagens incluídas/mês&#10;OpenAI GPT-4o Mini nativo&#10;Kanban de Atendimento"
          />
        </div>

        <DialogFooter className="pt-2 border-t border-ellevee-border">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isSaving}
            className="text-xs border-ellevee-border text-ellevee-deep-ink"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={isSaving}
            className="text-xs bg-ellevee-gradient hover:opacity-95 text-white px-5 rounded-lg shadow-sm font-semibold"
          >
            {isSaving ? "Salvando alterações..." : "Salvar Parâmetros"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
