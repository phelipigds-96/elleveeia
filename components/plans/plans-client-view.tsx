"use client"

import React, { useState } from "react"
import { PlatformPlan } from "@/lib/services/platform/plans"
import PlanEditDialog from "./plan-edit-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Layers,
  Sparkles,
  Bot,
  MessageSquare,
  Database,
  FileText,
  CheckCircle2,
  Sliders,
  ShieldCheck,
  Zap,
  Cpu,
} from "lucide-react"

interface PlansClientViewProps {
  initialPlans: PlatformPlan[]
}

export default function PlansClientView({ initialPlans }: PlansClientViewProps) {
  const [plans, setPlans] = useState<PlatformPlan[]>(initialPlans)
  const [editingPlan, setEditingPlan] = useState<PlatformPlan | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)

  const handleEditClick = (plan: PlatformPlan) => {
    setEditingPlan(plan)
    setIsEditDialogOpen(true)
  }

  const handlePlanSaved = (updated: PlatformPlan) => {
    setPlans((prev) =>
      prev.map((p) => (p.key === updated.key ? updated : p))
    )
  }

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-ellevee-stone/40 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-display text-2xl font-bold tracking-tight text-ellevee-ink">
              Planos e Limites Operacionais
            </h1>
            <Badge variant="outline" className="border-ellevee-ink/20 text-ellevee-ink font-mono text-[10px] px-2 py-0.5">
              4 NÍVEIS ATIVOS
            </Badge>
          </div>
          <p className="text-xs text-ellevee-sage leading-relaxed max-w-2xl">
            Configure precificação comercial, cotas mensais de mensagens, limites de agentes e padronização do motor de Inteligência Artificial para as organizações clientes.
          </p>
        </div>

        {/* Global LLM Provider Pill */}
        <div className="flex items-center gap-2.5 bg-emerald-50/80 border border-emerald-200/80 rounded-xl px-3.5 py-2 shrink-0">
          <div className="h-2 w-2 rounded-full bg-emerald-600 animate-pulse" />
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-700" />
              <span className="text-xs font-semibold text-emerald-950">
                OpenAI Primária Ativa
              </span>
            </div>
            <span className="text-[10px] text-emerald-800">
              GPT-4o Mini & GPT-4o por padrão
            </span>
          </div>
        </div>
      </div>

      {/* Grid de Planos da Plataforma */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {plans.map((plan) => {
          const isPro = plan.key === "pro"
          const isTrial = plan.key === "trial"
          const isEnterprise = plan.key === "enterprise"

          return (
            <div
              key={plan.key}
              className={`relative rounded-xl border flex flex-col justify-between transition-all bg-white shadow-sm hover:shadow-md ${
                isPro
                  ? "border-ellevee-ink ring-1 ring-ellevee-ink/10"
                  : "border-ellevee-stone/60"
              }`}
            >
              {/* Badge no topo para planos especiais */}
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border shadow-sm ${
                      isPro
                        ? "bg-ellevee-ink text-white border-ellevee-ink"
                        : "bg-emerald-50 text-emerald-800 border-emerald-200"
                    }`}
                  >
                    {isPro && <Sparkles className="w-2.5 h-2.5 text-ellevee-accent" />}
                    {plan.badge}
                  </span>
                </div>
              )}

              <div className="p-5 flex-1 flex flex-col">
                {/* Cabeçalho do Card */}
                <div className="pt-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-lg font-bold text-ellevee-ink">
                      {plan.name}
                    </h3>
                    <span className="text-[10px] font-mono uppercase text-ellevee-sage font-medium tracking-wider">
                      {plan.key}
                    </span>
                  </div>
                  <p className="text-[11px] text-ellevee-sage mt-1 min-h-[32px] line-clamp-2 leading-relaxed">
                    {plan.description}
                  </p>
                </div>

                {/* Preço Mensal */}
                <div className="my-4 pb-4 border-b border-ellevee-stone/40">
                  <div className="flex items-baseline gap-1">
                    {plan.priceMonthly === 0 ? (
                      <span className="font-display text-2xl font-extrabold text-ellevee-ink">
                        Gratuito
                      </span>
                    ) : (
                      <>
                        <span className="text-xs font-semibold text-ellevee-sage">R$</span>
                        <span className="font-display text-2xl font-extrabold text-ellevee-ink">
                          {plan.priceMonthly.toLocaleString("pt-BR")}
                        </span>
                        <span className="text-[11px] text-ellevee-sage font-medium">/mês</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Parâmetros e Cotas Principais */}
                <div className="space-y-2 mb-4 bg-ellevee-ivory/50 rounded-lg p-3 border border-ellevee-stone/40 text-xs">
                  <div className="flex items-center justify-between text-ellevee-ink">
                    <span className="flex items-center gap-1.5 text-ellevee-sage text-[11px]">
                      <MessageSquare className="w-3.5 h-3.5" /> Mensagens
                    </span>
                    <span className="font-semibold text-[11px]">
                      {plan.maxMonthlyMessages.toLocaleString("pt-BR")}/mês
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-ellevee-ink">
                    <span className="flex items-center gap-1.5 text-ellevee-sage text-[11px]">
                      <Bot className="w-3.5 h-3.5" /> Agentes
                    </span>
                    <span className="font-semibold text-[11px]">
                      Até {plan.maxAgents} {plan.maxAgents === 1 ? "agente" : "agentes"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-ellevee-ink">
                    <span className="flex items-center gap-1.5 text-ellevee-sage text-[11px]">
                      <Database className="w-3.5 h-3.5" /> Catálogo
                    </span>
                    <span className="font-semibold text-[11px]">
                      {plan.maxCatalogItems >= 200000
                        ? "Ilimitado"
                        : `${plan.maxCatalogItems.toLocaleString("pt-BR")} itens`}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-ellevee-ink pt-1 border-t border-ellevee-stone/30">
                    <span className="flex items-center gap-1.5 text-emerald-800 text-[11px] font-medium">
                      <Cpu className="w-3.5 h-3.5 text-emerald-700" /> IA Padrão
                    </span>
                    <span className="font-bold text-[11px] text-emerald-950 uppercase tracking-tight">
                      OpenAI · {plan.defaultAiModel}
                    </span>
                  </div>
                </div>

                {/* Lista de Features incluídas */}
                <div className="space-y-2 flex-1 mb-4">
                  <span className="text-[10px] font-bold text-ellevee-sage uppercase tracking-wider block">
                    Recursos Inclusos:
                  </span>
                  <ul className="space-y-1.5">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-[11px] text-ellevee-ink/80 leading-tight">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Botão de Ação no Rodapé do Card */}
              <div className="p-4 pt-0">
                <Button
                  onClick={() => handleEditClick(plan)}
                  variant="outline"
                  size="sm"
                  className="w-full text-xs font-semibold border-ellevee-stone hover:bg-ellevee-ink hover:text-white transition-all duration-150 flex items-center justify-center gap-1.5"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  Editar Parâmetros
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Diretriz Operacional de Infraestrutura de IA */}
      <div className="rounded-xl border border-ellevee-stone/60 bg-white p-5 shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-ellevee-ink text-white shrink-0">
              <Sparkles className="w-5 h-5 text-ellevee-accent" />
            </div>
            <div>
              <h3 className="font-display text-sm font-bold text-ellevee-ink">
                Diretriz Operacional de Inteligência Artificial — Foco OpenAI
              </h3>
              <p className="text-xs text-ellevee-sage mt-0.5 leading-relaxed">
                Conforme definido para o lançamento de produção da <strong>Sumel</strong> e novos clientes, a plataforma opera prioritariamente com <strong>OpenAI</strong> através dos modelos <code>gpt-4o-mini</code> (alta performance e eficiência de custo) e <code>gpt-4o</code> (raciocínio avançado e orçamentos complexos). Todas as novas empresas provisionadas herdam essas credenciais por padrão.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" className="text-xs text-emerald-800 bg-emerald-50 border-emerald-200 py-1 px-3">
              <ShieldCheck className="w-3.5 h-3.5 mr-1 text-emerald-600" />
              OpenAI API Ativa
            </Badge>
          </div>
        </div>
      </div>

      {/* Modal de Edição de Plano */}
      {editingPlan && (
        <PlanEditDialog
          plan={editingPlan}
          open={isEditDialogOpen}
          onClose={() => {
            setIsEditDialogOpen(false)
            setEditingPlan(null)
          }}
          onSave={handlePlanSaved}
        />
      )}
    </div>
  )
}
