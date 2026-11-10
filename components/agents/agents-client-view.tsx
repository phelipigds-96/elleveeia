"use client"

import React, { useState } from "react"
import { useRouter } from "next/navigation"
import { PlatformAgent, AgentBlueprintTemplate } from "@/lib/services/platform/agents"
import { toggleAgentStatusAction } from "@/app/(admin)/agents/actions"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Bot,
  Sparkles,
  Search,
  Filter,
  CheckCircle2,
  PauseCircle,
  PlayCircle,
  ExternalLink,
  Building2,
  Cpu,
  Clock,
  Layers,
  FileText,
  Sliders,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import { toast } from "@/components/ui/toast"

interface AgentsClientViewProps {
  initialAgents: PlatformAgent[]
  blueprints: AgentBlueprintTemplate[]
}

export default function AgentsClientView({
  initialAgents,
  blueprints,
}: AgentsClientViewProps) {
  const router = useRouter()
  const [agents, setAgents] = useState<PlatformAgent[]>(initialAgents)
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "PAUSED">("ALL")
  const [activeTab, setActiveTab] = useState<"instances" | "blueprints">("instances")
  const [expandedBlueprint, setExpandedBlueprint] = useState<string | null>("retail-confectionery")
  const [isTogglingId, setIsTogglingId] = useState<string | null>(null)

  // Filtros
  const filteredAgents = agents.filter((ag) => {
    const matchesSearch =
      ag.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ag.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ag.companySlug.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesStatus =
      statusFilter === "ALL"
        ? true
        : statusFilter === "ACTIVE"
        ? ag.isActive
        : !ag.isActive

    return matchesSearch && matchesStatus
  })

  const totalCount = agents.length
  const activeCount = agents.filter((a) => a.isActive).length

  const handleToggleStatus = async (agent: PlatformAgent) => {
    setIsTogglingId(agent.id)
    try {
      const nextState = !agent.isActive
      const res = await toggleAgentStatusAction(agent.id, nextState)

      if (!res.success) {
        toast.error("Erro ao alterar status", res.error || "Não foi possível atualizar o agente.")
        setIsTogglingId(null)
        return
      }

      toast.success(
        nextState ? "Agente ativado" : "Agente pausado",
        `O agente "${agent.name}" agora está ${nextState ? "ativo" : "pausado"}.`
      )

      setAgents((prev) =>
        prev.map((a) => (a.id === agent.id ? { ...a, isActive: nextState } : a))
      )
      setIsTogglingId(null)
      router.refresh()
    } catch {
      toast.error("Erro inesperado", "Ocorreu uma falha na comunicação com o servidor.")
      setIsTogglingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-ellevee-border pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-display text-2xl font-bold tracking-tight text-ellevee-deep-ink">
              Agentes de Inteligência Artificial
            </h1>
            <Badge variant="outline" className="border-ellevee-border text-ellevee-deep-ink bg-white font-mono text-[10px] px-2 py-0.5">
              TELEMETRIA GLOBAL
            </Badge>
          </div>
          <p className="text-xs text-ellevee-text-secondary leading-relaxed max-w-2xl">
            Monitore em tempo real todos os agentes autônomos provisionados nas empresas clientes e acesse o catálogo de blueprints prontos para novos setores.
          </p>
        </div>

        {/* Action / View switcher */}
        <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-ellevee-border shadow-2xs self-start md:self-auto">
          <button
            onClick={() => setActiveTab("instances")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === "instances"
                ? "bg-ellevee-deep-ink text-white shadow-sm"
                : "text-ellevee-text-secondary hover:text-ellevee-deep-ink"
            }`}
          >
            Agentes em Operação ({totalCount})
          </button>
          <button
            onClick={() => setActiveTab("blueprints")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === "blueprints"
                ? "bg-ellevee-deep-ink text-white shadow-sm"
                : "text-ellevee-text-secondary hover:text-ellevee-deep-ink"
            }`}
          >
            Blueprints & Modelos ({blueprints.length})
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-ellevee-border bg-white p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-ellevee-text-secondary uppercase tracking-wider">
              Total de Agentes
            </span>
            <Bot className="w-4 h-4 text-ellevee-deep-ink" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-ellevee-deep-ink">
              {totalCount}
            </span>
            <span className="text-[11px] text-ellevee-text-secondary">instanciados</span>
          </div>
        </div>

        <div className="rounded-xl border border-emerald-900/10 bg-emerald-50/50 p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-emerald-900 uppercase tracking-wider">
              Agentes Ativos
            </span>
            <div className="h-2 w-2 rounded-full bg-emerald-600 animate-pulse" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-emerald-950">
              {activeCount}
            </span>
            <span className="text-[11px] text-emerald-800">em tempo real</span>
          </div>
        </div>

        <div className="rounded-xl border border-ellevee-border bg-white p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-ellevee-text-secondary uppercase tracking-wider">
              Latência Média
            </span>
            <Clock className="w-4 h-4 text-ellevee-text-secondary" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-ellevee-deep-ink">
              1.1s
            </span>
            <span className="text-[11px] text-emerald-700 font-medium">OpenAI gpt-4o-mini</span>
          </div>
        </div>

        <div className="rounded-xl border border-ellevee-border bg-white p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-ellevee-text-secondary uppercase tracking-wider">
              Motor Primário
            </span>
            <Sparkles className="w-4 h-4 text-ellevee-purple" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-lg font-bold text-ellevee-deep-ink truncate">
              OpenAI
            </span>
            <span className="text-[10px] font-mono text-emerald-800 bg-emerald-100/70 px-1.5 py-0.5 rounded border border-emerald-200">
              GPT-4o Nativo
            </span>
          </div>
        </div>
      </div>

      {activeTab === "instances" ? (
        /* Seção 1: Agentes em Operação */
        <div className="space-y-4">
          {/* Barra de Filtros */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 rounded-xl border border-ellevee-border shadow-card">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-ellevee-text-secondary" />
              <Input
                type="text"
                placeholder="Buscar por agente ou empresa..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-8 text-xs bg-[#F8F8F6] border-ellevee-border"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <span className="text-[11px] text-ellevee-text-secondary font-medium">Status:</span>
              <div className="flex items-center gap-1 bg-[#F8F8F6] p-0.5 rounded-lg border border-ellevee-border">
                <button
                  onClick={() => setStatusFilter("ALL")}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-all ${
                    statusFilter === "ALL"
                      ? "bg-white text-ellevee-deep-ink shadow-2xs font-semibold"
                      : "text-ellevee-text-secondary hover:text-ellevee-deep-ink"
                  }`}
                >
                  Todos ({totalCount})
                </button>
                <button
                  onClick={() => setStatusFilter("ACTIVE")}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-all ${
                    statusFilter === "ACTIVE"
                      ? "bg-white text-emerald-800 shadow-2xs font-semibold"
                      : "text-ellevee-text-secondary hover:text-ellevee-deep-ink"
                  }`}
                >
                  Ativos ({activeCount})
                </button>
                <button
                  onClick={() => setStatusFilter("PAUSED")}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-all ${
                    statusFilter === "PAUSED"
                      ? "bg-white text-amber-800 shadow-2xs font-semibold"
                      : "text-ellevee-text-secondary hover:text-ellevee-deep-ink"
                  }`}
                >
                  Pausados ({totalCount - activeCount})
                </button>
              </div>
            </div>
          </div>

          {/* Lista de Agentes */}
          {filteredAgents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ellevee-border bg-white p-12 text-center">
              <Bot className="w-10 h-10 text-ellevee-text-secondary mx-auto mb-3 opacity-60" />
              <h3 className="font-display text-base font-bold text-ellevee-deep-ink">
                Nenhum agente em execução encontrado
              </h3>
              <p className="text-xs text-ellevee-text-secondary mt-1 max-w-md mx-auto leading-relaxed">
                {searchTerm
                  ? "Nenhum agente corresponde aos termos pesquisados."
                  : "Quando novas organizações (como a Sumel) forem provisionadas e configurarem seus fluxos de atendimento, os agentes aparecerão consolidados aqui com telemetria completa."}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-ellevee-border bg-white overflow-hidden shadow-card">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-ellevee-deep-ink">
                  <thead className="bg-[#F8F8F6] border-b border-ellevee-border text-[11px] font-bold uppercase tracking-wider text-ellevee-text-secondary">
                    <tr>
                      <th className="py-3 px-4">Agente</th>
                      <th className="py-3 px-4">Empresa (Tenant)</th>
                      <th className="py-3 px-4">Modelo & Provedor</th>
                      <th className="py-3 px-4">Segmento</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Ação / Kill-Switch</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ellevee-border/60">
                    {filteredAgents.map((ag) => (
                      <tr key={ag.id} className="hover:bg-ellevee-warm-ivory/30 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <div className="h-8 w-8 rounded-lg bg-ellevee-warm-ivory border border-ellevee-border flex items-center justify-center shrink-0">
                              <Bot className="w-4 h-4 text-ellevee-deep-ink" />
                            </div>
                            <div>
                              <span className="font-semibold text-xs text-ellevee-deep-ink block font-display">
                                {ag.name}
                              </span>
                              <span className="text-[10px] text-ellevee-text-secondary font-mono">
                                id: {ag.id.slice(0, 8)}...
                              </span>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-ellevee-text-secondary shrink-0" />
                            <div>
                              <span className="font-medium text-xs text-ellevee-deep-ink block">
                                {ag.companyName}
                              </span>
                              <span className="text-[10px] text-ellevee-text-secondary font-mono">
                                @{ag.companySlug}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[11px] font-semibold text-emerald-950 flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-ellevee-purple" />
                              OpenAI
                            </span>
                            <span className="text-[10px] font-mono text-ellevee-text-secondary">
                              {ag.model}
                            </span>
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <span className="text-[11px] text-ellevee-text-secondary">
                            {ag.segment || "Geral / Varejo"}
                          </span>
                        </td>

                        <td className="py-3 px-4">
                          {ag.isActive ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                              Ativo
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                              Pausado
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right">
                          <Button
                            onClick={() => handleToggleStatus(ag)}
                            disabled={isTogglingId === ag.id}
                            variant="outline"
                            size="sm"
                            className={`text-xs h-7 px-2.5 font-medium border-ellevee-border ${
                              ag.isActive
                                ? "text-amber-800 hover:bg-amber-50"
                                : "text-emerald-800 hover:bg-emerald-50"
                            }`}
                          >
                            {isTogglingId === ag.id ? (
                              "Salvando..."
                            ) : ag.isActive ? (
                              <>
                                <PauseCircle className="w-3.5 h-3.5 mr-1 text-amber-700" />
                                Pausar
                              </>
                            ) : (
                              <>
                                <PlayCircle className="w-3.5 h-3.5 mr-1 text-emerald-700" />
                                Reativar
                              </>
                            )}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Seção 2: Blueprints & Modelos Prontos */
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-ellevee-border bg-white shadow-card">
            <h3 className="font-display text-sm font-bold text-ellevee-deep-ink">
              Catálogo de Blueprints Prontos (Ellevee IA)
            </h3>
            <p className="text-xs text-ellevee-text-secondary mt-0.5">
              Templates arquitetados com as melhores instruções, persona e integração nativa com OpenAI para acelerar o onboarding de clientes de cada segmento.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {blueprints.map((bp) => {
              const isExpanded = expandedBlueprint === bp.key
              const isSumel = bp.key === "retail-confectionery"

              return (
                <div
                  key={bp.key}
                  className={`rounded-xl border bg-white p-5 shadow-card transition-all flex flex-col justify-between ${
                    isSumel
                      ? "border-ellevee-purple/70 ring-1 ring-ellevee-purple/30 shadow-card-hover"
                      : "border-ellevee-border"
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-display text-base font-bold text-ellevee-deep-ink">
                            {bp.name}
                          </h4>
                        </div>
                        <span className="text-[10px] font-mono text-ellevee-text-secondary uppercase tracking-wider block mt-0.5">
                          {bp.segment}
                        </span>
                      </div>
                      <Badge
                        variant={isSumel ? "default" : "outline"}
                        className={`text-[10px] shrink-0 ${isSumel ? "bg-ellevee-gradient text-white border-transparent" : "border-ellevee-border text-ellevee-deep-ink"}`}
                      >
                        {bp.badge}
                      </Badge>
                    </div>

                    <p className="text-xs text-ellevee-text-secondary mt-2 leading-relaxed">
                      {bp.description}
                    </p>

                    <div className="mt-4 pt-3 border-t border-ellevee-border space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-ellevee-text-secondary">Público-alvo:</span>
                        <span className="font-medium text-[11px] text-ellevee-deep-ink">
                          {bp.targetAudience}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-emerald-800 font-medium flex items-center gap-1">
                          <Cpu className="w-3 h-3 text-ellevee-purple" /> Motor de IA:
                        </span>
                        <span className="font-bold text-[11px] text-emerald-950 font-mono">
                          OpenAI · {bp.recommendedModel}
                        </span>
                      </div>
                    </div>

                    {/* Exibir instruções de prompt */}
                    <div className="mt-3">
                      <button
                        onClick={() =>
                          setExpandedBlueprint(isExpanded ? null : bp.key)
                        }
                        className="flex items-center gap-1 text-[11px] font-semibold text-ellevee-deep-ink hover:underline"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="w-3.5 h-3.5" />
                            Ocultar Instruções Padrão
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3.5 h-3.5" />
                            Ver Instruções Padrão do Agente
                          </>
                        )}
                      </button>

                      {isExpanded && (
                        <div className="mt-2 p-3 bg-[#F8F8F6] border border-ellevee-border rounded-lg text-[11px] text-ellevee-deep-ink/80 font-mono leading-relaxed">
                          {bp.sampleInstructions}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
