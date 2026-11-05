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
  Filter, 
  Bot,
  X,
  Calendar,
  Layers
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
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
import { CompanyMock, INITIAL_MOCK_COMPANIES } from "./mock-companies"
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

  // Modals state
  const [activeCompanyForLimits, setActiveCompanyForLimits] = useState<CompanyMock | null>(null)
  const [activeCompanyForPlan, setActiveCompanyForPlan] = useState<CompanyMock | null>(null)
  const [activeCompanyForStatus, setActiveCompanyForStatus] = useState<CompanyMock | null>(null)
  const [impersonateToast, setImpersonateToast] = useState<string | null>(null)

  // Has active filters?
  const hasActiveFilters = searchTerm !== "" || planFilter !== "ALL" || statusFilter !== "ALL" || providerFilter !== "ALL"

  const handleClearFilters = () => {
    setSearchTerm("")
    setPlanFilter("ALL")
    setStatusFilter("ALL")
    setProviderFilter("ALL")
  }

  // Filtered companies
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
        return <Badge variant="outline">Trial</Badge>
      case "Starter":
        return <Badge variant="secondary">Starter</Badge>
      case "Pro":
        return <Badge variant="default">Pro</Badge>
      case "Enterprise":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-ellevee-ink text-white">
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
          <span className="text-[11px] font-mono font-medium text-ellevee-ink bg-[#F3F2ED] px-2 py-0.5 rounded border border-ellevee-stone">
            OpenAI
          </span>
        )
      case "gemini":
        return (
          <span className="text-[11px] font-mono font-medium text-ellevee-ink bg-[#F3F2ED] px-2 py-0.5 rounded border border-ellevee-stone">
            Gemini
          </span>
        )
      case "hybrid":
        return (
          <span className="text-[11px] font-mono font-medium text-ellevee-ink bg-[#F3F2ED] px-2 py-0.5 rounded border border-ellevee-stone">
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
            <p className="text-[11px] text-ellevee-sage">{impersonateToast}</p>
          </div>
        </div>
      )}

      {/* Barra de Filtros e Busca (Quiet Technology) */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-white p-3.5 rounded-lg border border-ellevee-stone shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ellevee-sage" />
          <Input
            placeholder="Buscar por nome, slug ou CNPJ..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Filtro por Plano */}
          <select
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
            className="h-9 rounded-md border border-ellevee-stone bg-[#F8F8F5] px-3 text-xs font-medium text-ellevee-ink focus:outline-none focus:ring-1 focus:ring-ellevee-ink"
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
            className="h-9 rounded-md border border-ellevee-stone bg-[#F8F8F5] px-3 text-xs font-medium text-ellevee-ink focus:outline-none focus:ring-1 focus:ring-ellevee-ink"
          >
            <option value="ALL">Todos os Status</option>
            <option value="Ativo">Ativas</option>
            <option value="Suspenso">Suspensas</option>
          </select>

          {/* Filtro por Provedor */}
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="h-9 rounded-md border border-ellevee-stone bg-[#F8F8F5] px-3 text-xs font-medium text-ellevee-ink focus:outline-none focus:ring-1 focus:ring-ellevee-ink"
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
              className="h-9 px-2.5 text-xs text-ellevee-sage hover:text-ellevee-ink border-ellevee-stone gap-1"
            >
              <X className="h-3.5 w-3.5" />
              <span>Limpar filtros</span>
            </Button>
          )}
        </div>
      </div>

      {/* Data Table de Empresas (8 Colunas) */}
      <div className="rounded-lg border border-ellevee-stone bg-white shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[260px]">Empresa</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[200px]">Consumo</TableHead>
              <TableHead>Agentes</TableHead>
              <TableHead>Provedor</TableHead>
              <TableHead>Cadastro</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-xs text-ellevee-sage">
                  Nenhuma organização encontrada para os filtros selecionados.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((company) => {
                const usagePercent = Math.round(
                  (company.messagesUsed / company.messagesLimit) * 100
                )
                const isNearLimit = usagePercent >= 80

                return (
                  <TableRow key={company.id} className="hover:bg-[#FBFBFA]">
                    {/* 1. Empresa: Monograma + Nome + Slug/CNPJ */}
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-md bg-[#F3F2ED] border border-ellevee-stone text-ellevee-ink flex items-center justify-center font-display font-bold text-xs shrink-0">
                          {company.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="font-semibold text-xs text-ellevee-ink truncate font-sans">
                            {company.name}
                          </span>
                          <div className="flex items-center gap-1.5 text-[10px] text-ellevee-sage">
                            <span className="font-mono text-ellevee-sage">@{company.slug}</span>
                            <span>•</span>
                            <span>{company.cnpj}</span>
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    {/* 2. Plano */}
                    <TableCell>{getPlanBadge(company.plan)}</TableCell>

                    {/* 3. Status */}
                    <TableCell>
                      {company.status === "Ativo" ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#F4F8E8] text-[#3D5215] border border-[#D5E89B]/50">
                          <span className="h-1.5 w-1.5 rounded-full bg-ellevee-accent ring-1 ring-ellevee-ink/10" />
                          Ativo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-stone-100 text-stone-700 border border-stone-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                          Suspenso
                        </span>
                      )}
                    </TableCell>

                    {/* 4. Consumo com Progress Bar */}
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] font-medium font-mono">
                          <span className="text-ellevee-ink">
                            {(company.messagesUsed / 1000).toFixed(1)}K / {(company.messagesLimit / 1000).toFixed(0)}K msgs
                          </span>
                          <span className={`text-[10px] font-bold ${isNearLimit ? "text-rose-600" : "text-ellevee-sage"}`}>
                            {usagePercent}%
                          </span>
                        </div>
                        <Progress value={usagePercent} />
                        <div className="flex justify-between text-[9px] text-ellevee-sage font-mono">
                          <span>{(company.tokensUsed / 1000000).toFixed(1)}M tokens</span>
                          <span>Cap: {(company.tokensLimit / 1000000).toFixed(1)}M</span>
                        </div>
                      </div>
                    </TableCell>

                    {/* 5. Agentes */}
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs font-medium text-ellevee-ink font-mono">
                        <Bot className="h-3.5 w-3.5 text-ellevee-sage" />
                        <span>
                          {company.agentsCount} / {company.maxAgents}
                        </span>
                      </div>
                    </TableCell>

                    {/* 6. Provedor de IA */}
                    <TableCell>{getAiProviderBadge(company.aiProvider)}</TableCell>

                    {/* 7. Cadastro */}
                    <TableCell>
                      <span className="text-xs text-ellevee-sage font-mono">
                        {formatDate(company.createdAt)}
                      </span>
                    </TableCell>

                    {/* 8. Ações */}
                    <TableCell className="text-right">
                      <DropdownMenu
                        trigger={
                          <button className="h-7 w-7 rounded-md border border-ellevee-stone bg-white text-ellevee-sage hover:text-ellevee-ink hover:bg-[#F8F8F5] inline-flex items-center justify-center transition-colors">
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

        {/* Rodapé da Tabela */}
        <div className="px-6 py-3 border-t border-ellevee-stone bg-[#FBFBFA] flex items-center justify-between text-xs text-ellevee-sage">
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
