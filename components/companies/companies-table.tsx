"use client"

import React, { useState, useMemo } from "react"
import { 
  Building2, 
  MoreVertical, 
  Sliders, 
  Award, 
  Ban, 
  CheckCircle2, 
  LogIn, 
  Search, 
  Bot,
  X
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { 
  CompanyMock, 
  INITIAL_MOCK_COMPANIES,
  formatCompactNumber,
  calculateUsagePercent,
  getUsageStatus
} from "./mock-companies"
import CompanyLimitsDialog from "./company-limits-dialog"
import CompanyPlanDialog from "./company-plan-dialog"
import CompanyStatusDialog from "./company-status-dialog"

export default function CompaniesTable({
  companies = INITIAL_MOCK_COMPANIES,
  onUpdateCompany,
}: {
  companies?: CompanyMock[]
  onUpdateCompany?: (updated: CompanyMock) => void
}) {
  const [searchTerm, setSearchTerm] = useState("")
  const [planFilter, setPlanFilter] = useState<string>("ALL")
  const [statusFilter, setStatusFilter] = useState<string>("ALL")
  const [providerFilter, setProviderFilter] = useState<string>("ALL")

  // Modais de Ação
  const [activeCompanyForLimits, setActiveCompanyForLimits] = useState<CompanyMock | null>(null)
  const [activeCompanyForPlan, setActiveCompanyForPlan] = useState<CompanyMock | null>(null)
  const [activeCompanyForStatus, setActiveCompanyForStatus] = useState<CompanyMock | null>(null)
  const [impersonateToast, setImpersonateToast] = useState<string | null>(null)

  // Filtros ativos?
  const hasActiveFilters = searchTerm !== "" || planFilter !== "ALL" || statusFilter !== "ALL" || providerFilter !== "ALL"

  const handleClearFilters = () => {
    setSearchTerm("")
    setPlanFilter("ALL")
    setStatusFilter("ALL")
    setProviderFilter("ALL")
  }

  // Lista Filtrada
  const filtered = useMemo(() => {
    return companies.filter((c) => {
      const matchesSearch =
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.slug.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.cnpj.includes(searchTerm)

      const matchesPlan = planFilter === "ALL" || c.plan === planFilter
      const matchesStatus = statusFilter === "ALL" || c.status === statusFilter
      const matchesProvider = providerFilter === "ALL" || c.aiProvider === providerFilter

      return matchesSearch && matchesPlan && matchesStatus && matchesProvider
    })
  }, [companies, searchTerm, planFilter, statusFilter, providerFilter])

  const handleImpersonate = (company: CompanyMock) => {
    setImpersonateToast(`Sessão administrativa iniciada como ${company.name} (@${company.slug})`)
    setTimeout(() => setImpersonateToast(null), 3500)
  }

  const getPlanBadge = (plan: CompanyMock["plan"]) => {
    switch (plan) {
      case "Trial":
        return <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-medium">Trial</Badge>
      case "Starter":
        return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-medium">Starter</Badge>
      case "Pro":
        return <Badge variant="default" className="text-[10px] px-1.5 py-0 font-medium">Pro</Badge>
      case "Enterprise":
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-ellevee-ink text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-ellevee-accent" />
            Enterprise
          </span>
        )
    }
  }

  const getAiProviderBadge = (provider: CompanyMock["aiProvider"]) => {
    switch (provider) {
      case "openai":
        return (
          <span className="text-[10px] font-mono font-medium text-ellevee-ink bg-[#F3F2ED] px-1.5 py-0.5 rounded border border-ellevee-stone inline-block text-center">
            OpenAI
          </span>
        )
      case "gemini":
        return (
          <span className="text-[10px] font-mono font-medium text-ellevee-ink bg-[#F3F2ED] px-1.5 py-0.5 rounded border border-ellevee-stone inline-block text-center">
            Gemini
          </span>
        )
      case "hybrid":
        return (
          <span className="text-[10px] font-mono font-medium text-ellevee-ink bg-[#F3F2ED] px-1.5 py-0.5 rounded border border-ellevee-stone inline-block text-center">
            Híbrido
          </span>
        )
    }
  }

  const formatDate = (dateString: string) => {
    const parts = dateString.split("-")
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`
    }
    return dateString
  }

  return (
    <div className="space-y-4">
      {/* Toast Simulado de Impersonate */}
      {impersonateToast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg bg-ellevee-ink text-white p-4 shadow-2xl flex items-center gap-3 border border-white/10 animate-in slide-in-from-bottom-5">
          <div className="h-8 w-8 rounded-md bg-white/10 flex items-center justify-center text-ellevee-accent">
            <LogIn className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs font-bold font-display">Modo Impersonate Ativo</p>
            <p className="text-[11px] text-[#A6B5A6]">{impersonateToast}</p>
          </div>
        </div>
      )}

      {/* Barra de Filtros e Busca */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-white p-3 rounded-lg border border-ellevee-stone shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ellevee-sage" />
          <Input
            placeholder="Buscar por nome, slug ou CNPJ..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-8.5 text-xs bg-[#FBFBFA]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Filtro por Plano */}
          <select
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
            className="h-8.5 rounded-md border border-ellevee-stone bg-[#F8F8F5] px-2.5 text-xs font-medium text-ellevee-ink focus:outline-none focus:ring-1 focus:ring-ellevee-ink"
          >
            <option value="ALL">Todos os Planos</option>
            <option value="Trial">Trial</option>
            <option value="Starter">Starter</option>
            <option value="Pro">Pro</option>
            <option value="Enterprise">Enterprise</option>
          </select>

          {/* Filtro por Status */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8.5 rounded-md border border-ellevee-stone bg-[#F8F8F5] px-2.5 text-xs font-medium text-ellevee-ink focus:outline-none focus:ring-1 focus:ring-ellevee-ink"
          >
            <option value="ALL">Todos os Status</option>
            <option value="Ativo">Ativas</option>
            <option value="Suspenso">Suspensas</option>
          </select>

          {/* Filtro por Provedor */}
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="h-8.5 rounded-md border border-ellevee-stone bg-[#F8F8F5] px-2.5 text-xs font-medium text-ellevee-ink focus:outline-none focus:ring-1 focus:ring-ellevee-ink"
          >
            <option value="ALL">Todos os Provedores</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
            <option value="hybrid">Híbrido</option>
          </select>

          {/* Botão Limpar Filtros */}
          {hasActiveFilters && (
            <Button
              onClick={handleClearFilters}
              variant="outline"
              size="sm"
              className="h-8.5 px-2.5 text-xs text-ellevee-sage hover:text-ellevee-ink border-ellevee-stone gap-1"
            >
              <X className="h-3.5 w-3.5" />
              <span>Limpar filtros</span>
            </Button>
          )}
        </div>
      </div>

      {/* Data Table de Empresas — Estrutura Compacta e Sem Rolagem Horizontal em 1366px/1440px */}
      <div className="rounded-lg border border-ellevee-stone bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="table-fixed w-full min-w-[880px]">
            <TableHeader>
              <TableRow className="border-b border-ellevee-stone bg-[#F8F8F5]">
                <TableHead className="w-[230px] text-xs font-semibold text-ellevee-sage py-2.5 px-3">Empresa</TableHead>
                <TableHead className="w-[85px] text-xs font-semibold text-ellevee-sage py-2.5 px-3">Plano</TableHead>
                <TableHead className="w-[85px] text-xs font-semibold text-ellevee-sage py-2.5 px-3">Status</TableHead>
                <TableHead className="w-[195px] text-xs font-semibold text-ellevee-sage py-2.5 px-3">Consumo</TableHead>
                <TableHead className="w-[80px] text-xs font-semibold text-ellevee-sage py-2.5 px-3">Agentes</TableHead>
                <TableHead className="w-[90px] text-xs font-semibold text-ellevee-sage py-2.5 px-3">Provedor</TableHead>
                <TableHead className="w-[85px] text-xs font-semibold text-ellevee-sage py-2.5 px-3">Cadastro</TableHead>
                <TableHead className="w-[45px] text-right text-xs font-semibold text-ellevee-sage py-2.5 px-3">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-28 text-center text-xs text-ellevee-sage">
                    Nenhuma organização encontrada para os filtros selecionados.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((company) => {
                  const usagePercent = calculateUsagePercent(company.messagesUsed, company.messagesLimit)
                  const usageStatus = getUsageStatus(usagePercent)

                  return (
                    <TableRow key={company.id} className="hover:bg-[#FBFBFA] border-b border-ellevee-stone/60">
                      {/* 1. Empresa: Monograma 32px + Vertical Stack */}
                      <TableCell className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="h-8 w-8 rounded-md bg-[#F3F2ED] border border-ellevee-stone text-ellevee-ink flex items-center justify-center font-display font-bold text-xs shrink-0">
                            {company.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-semibold text-xs text-ellevee-ink truncate leading-tight block">
                              {company.name}
                            </span>
                            <div className="flex items-center gap-1 text-[10px] text-ellevee-sage leading-tight mt-0.5 truncate">
                              <span className="font-mono text-ellevee-sage/90">@{company.slug}</span>
                              <span>•</span>
                              <span className="truncate">{company.cnpj}</span>
                            </div>
                          </div>
                        </div>
                      </TableCell>

                      {/* 2. Plano */}
                      <TableCell className="py-2.5 px-3">
                        {getPlanBadge(company.plan)}
                      </TableCell>

                      {/* 3. Status */}
                      <TableCell className="py-2.5 px-3">
                        {company.status === "Ativo" ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#F4F8E8] text-[#3D5215] border border-[#D5E89B]/50">
                            <span className="h-1.5 w-1.5 rounded-full bg-ellevee-accent ring-1 ring-ellevee-ink/10" />
                            Ativo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-stone-100 text-stone-700 border border-stone-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                            Suspenso
                          </span>
                        )}
                      </TableCell>

                      {/* 4. Consumo: Line 1 (Msgs • %) + Line 2 (Barra) + Line 3 (Tokens) */}
                      <TableCell className="py-2.5 px-3">
                        <div className="space-y-1.5">
                          {/* Linha 1: 48,5K / 50K msgs • 97% */}
                          <div className="flex items-center justify-between text-[11px] font-mono leading-none">
                            <span className="text-ellevee-ink font-medium">
                              {formatCompactNumber(company.messagesUsed)} / {formatCompactNumber(company.messagesLimit)} msgs
                            </span>
                            <span className={usageStatus.textColor}>
                              {usagePercent}%
                            </span>
                          </div>

                          {/* Linha 2: Barra de Progresso com Cor Condicional */}
                          <div className="w-full bg-[#EAE8E1] h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${usageStatus.barColor}`}
                              style={{ width: `${Math.min(usagePercent, 100)}%` }}
                            />
                          </div>

                          {/* Linha 3: 3,8M / 5M tokens */}
                          <div className="text-[10px] text-ellevee-sage font-mono leading-none">
                            {formatCompactNumber(company.tokensUsed)} / {formatCompactNumber(company.tokensLimit)} tokens
                          </div>
                        </div>
                      </TableCell>

                      {/* 5. Agentes */}
                      <TableCell className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-ellevee-ink font-mono">
                          <Bot className="h-3.5 w-3.5 text-ellevee-sage" />
                          <span>
                            {company.agentsCount} / {company.maxAgents}
                          </span>
                        </div>
                      </TableCell>

                      {/* 6. Provedor IA */}
                      <TableCell className="py-2.5 px-3">
                        {getAiProviderBadge(company.aiProvider)}
                      </TableCell>

                      {/* 7. Cadastro */}
                      <TableCell className="py-2.5 px-3">
                        <span className="text-xs text-ellevee-sage font-mono">
                          {formatDate(company.createdAt)}
                        </span>
                      </TableCell>

                      {/* 8. Ações: Sempre Visível */}
                      <TableCell className="py-2.5 px-3 text-right">
                        <DropdownMenu
                          trigger={
                            <button className="h-7 w-7 rounded border border-ellevee-stone bg-white text-ellevee-sage hover:text-ellevee-ink hover:bg-[#F8F8F5] inline-flex items-center justify-center transition-colors">
                              <MoreVertical className="h-3.5 w-3.5" />
                            </button>
                          }
                        >
                          <DropdownMenuLabel>Ações da Empresa</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => setActiveCompanyForPlan(company)}>
                            <Award className="h-3.5 w-3.5 mr-2 text-ellevee-ink" />
                            Editar Plano
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setActiveCompanyForLimits(company)}>
                            <Sliders className="h-3.5 w-3.5 mr-2 text-ellevee-ink" />
                            Ajustar Limites
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleImpersonate(company)}>
                            <LogIn className="h-3.5 w-3.5 mr-2 text-ellevee-ink" />
                            Acessar como (Impersonate)
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            destructive={company.status === "Ativo"}
                            onClick={() => setActiveCompanyForStatus(company)}
                          >
                            {company.status === "Ativo" ? (
                              <>
                                <Ban className="h-3.5 w-3.5 mr-2" />
                                Suspender Empresa
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-600" />
                                Reativar Empresa
                              </>
                            )}
                          </DropdownMenuItem>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Rodapé da Tabela */}
        <div className="px-4 py-2.5 border-t border-ellevee-stone bg-[#FBFBFA] flex items-center justify-between text-xs text-ellevee-sage">
          <span>
            Exibindo <strong className="text-ellevee-ink font-mono">{filtered.length}</strong> de{" "}
            <strong className="text-ellevee-ink font-mono">{companies.length}</strong> organizações
          </span>
          <div className="flex items-center gap-4 text-[11px] font-mono">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {companies.filter((c) => c.status === "Ativo").length} Ativas
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
              {companies.filter((c) => c.status === "Suspenso").length} Suspensas
            </span>
          </div>
        </div>
      </div>

      {/* Modais de Ação */}
      <CompanyLimitsDialog
        company={activeCompanyForLimits}
        open={!!activeCompanyForLimits}
        onClose={() => setActiveCompanyForLimits(null)}
        onSave={(updated) => {
          if (onUpdateCompany) onUpdateCompany(updated)
          setActiveCompanyForLimits(null)
        }}
      />

      <CompanyPlanDialog
        company={activeCompanyForPlan}
        open={!!activeCompanyForPlan}
        onClose={() => setActiveCompanyForPlan(null)}
        onSave={(updated) => {
          if (onUpdateCompany) onUpdateCompany(updated)
          setActiveCompanyForPlan(null)
        }}
      />

      <CompanyStatusDialog
        company={activeCompanyForStatus}
        open={!!activeCompanyForStatus}
        onClose={() => setActiveCompanyForStatus(null)}
        onSave={(updated) => {
          if (onUpdateCompany) onUpdateCompany(updated)
          setActiveCompanyForStatus(null)
        }}
      />
    </div>
  )
}
