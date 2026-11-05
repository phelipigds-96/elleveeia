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
  Sparkles,
  Bot
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

  // Selected company for dialogs
  const [activeCompanyForLimits, setActiveCompanyForLimits] = useState<CompanyMock | null>(null)
  const [activeCompanyForPlan, setActiveCompanyForPlan] = useState<CompanyMock | null>(null)
  const [activeCompanyForStatus, setActiveCompanyForStatus] = useState<CompanyMock | null>(null)
  const [impersonateToast, setImpersonateToast] = useState<string | null>(null)

  // Filtered companies
  const filtered = useMemo(() => {
    return companies.filter((c) => {
      const matchesSearch =
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.slug.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.cnpj.includes(searchTerm)

      const matchesPlan = planFilter === "ALL" || c.plan === planFilter
      const matchesStatus = statusFilter === "ALL" || c.status === statusFilter

      return matchesSearch && matchesPlan && matchesStatus
    })
  }, [companies, searchTerm, planFilter, statusFilter])

  const handleImpersonate = (company: CompanyMock) => {
    setImpersonateToast(`Sessão administrativa iniciada como ${company.name} (@${company.slug})`)
    setTimeout(() => setImpersonateToast(null), 3500)
  }

  const getPlanBadge = (plan: CompanyMock["plan"]) => {
    switch (plan) {
      case "Trial":
        return <Badge variant="outline">Trial</Badge>
      case "Starter":
        return <Badge variant="info">Starter</Badge>
      case "Pro":
        return <Badge variant="purple">Pro</Badge>
      case "Enterprise":
        return <Badge variant="default">Enterprise</Badge>
    }
  }

  const getAiProviderBadge = (provider: CompanyMock["aiProvider"]) => {
    switch (provider) {
      case "openai":
        return <span className="text-[11px] font-mono font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">OpenAI</span>
      case "gemini":
        return <span className="text-[11px] font-mono font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">Gemini</span>
      case "hybrid":
        return <span className="text-[11px] font-mono font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">Híbrido</span>
    }
  }

  return (
    <div className="space-y-4">
      {/* Toast Simulado de Impersonate */}
      {impersonateToast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-slate-900 text-white p-4 shadow-2xl flex items-center gap-3 border border-slate-700 animate-in slide-in-from-bottom-5">
          <div className="h-8 w-8 rounded-full bg-indigo-600 flex items-center justify-center text-white">
            <LogIn className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs font-bold">Modo Impersonate Ativo</p>
            <p className="text-[11px] text-slate-300">{impersonateToast}</p>
          </div>
        </div>
      )}

      {/* Barra de Filtros e Busca */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por nome, slug ou CNPJ..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Filtro por Plano */}
          <select
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-600"
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
            className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          >
            <option value="ALL">Todos os Status</option>
            <option value="Ativo">Ativos</option>
            <option value="Suspenso">Suspensos</option>
          </select>
        </div>
      </div>

      {/* Tabela de Empresas */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[280px]">Empresa</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[220px]">Uso de Mensagens</TableHead>
              <TableHead>Agentes</TableHead>
              <TableHead>Provedor IA</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-slate-500">
                  Nenhuma empresa encontrada com os filtros selecionados.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((company) => {
                const usagePercent = Math.round(
                  (company.messagesUsed / company.messagesLimit) * 100
                )
                const isNearLimit = usagePercent >= 80

                return (
                  <TableRow key={company.id}>
                    {/* Empresa: Avatar + Nome + Slug/CNPJ */}
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 border border-slate-200 text-slate-700 flex items-center justify-center font-bold text-sm shrink-0 shadow-inner">
                          {company.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="font-semibold text-slate-900 truncate">
                            {company.name}
                          </span>
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                            <span className="font-mono text-slate-500">@{company.slug}</span>
                            <span>•</span>
                            <span>{company.cnpj}</span>
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    {/* Plano */}
                    <TableCell>{getPlanBadge(company.plan)}</TableCell>

                    {/* Status com bolinha pulsante */}
                    <TableCell>
                      {company.status === "Ativo" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Ativo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200/80">
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                          Suspenso
                        </span>
                      )}
                    </TableCell>

                    {/* Uso de Mensagens com Progress Bar */}
                    <TableCell>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-medium">
                          <span className="text-slate-700 font-mono">
                            {company.messagesUsed.toLocaleString()} / {company.messagesLimit.toLocaleString()}
                          </span>
                          <span className={`text-[11px] font-bold font-mono ${isNearLimit ? "text-rose-600" : "text-slate-500"}`}>
                            {usagePercent}%
                          </span>
                        </div>
                        <Progress value={usagePercent} />
                        <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                          <span>Tokens: {(company.tokensUsed / 1000000).toFixed(1)}M</span>
                          <span>Max: {(company.tokensLimit / 1000000).toFixed(1)}M</span>
                        </div>
                      </div>
                    </TableCell>

                    {/* Agentes */}
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                        <Bot className="h-4 w-4 text-slate-400" />
                        <span>
                          {company.agentsCount} / {company.maxAgents}
                        </span>
                      </div>
                    </TableCell>

                    {/* Provedor de IA */}
                    <TableCell>{getAiProviderBadge(company.aiProvider)}</TableCell>

                    {/* Ações */}
                    <TableCell className="text-right">
                      <DropdownMenu
                        trigger={
                          <button className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50 flex items-center justify-center transition-colors">
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        }
                      >
                        <DropdownMenuLabel>Ações do Tenant</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => setActiveCompanyForPlan(company)}>
                          <Award className="h-3.5 w-3.5 mr-2 text-purple-600" />
                          Editar Plano
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setActiveCompanyForLimits(company)}>
                          <Sliders className="h-3.5 w-3.5 mr-2 text-amber-600" />
                          Ajustar Limites
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleImpersonate(company)}>
                          <LogIn className="h-3.5 w-3.5 mr-2 text-indigo-600" />
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
                              Bloquear Empresa
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

        {/* Footer da Tabela com Totais */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/75 flex items-center justify-between text-xs text-slate-500">
          <span>
            Exibindo <strong className="text-slate-800">{filtered.length}</strong> de{" "}
            <strong className="text-slate-800">{companies.length}</strong> empresas cadastradas
          </span>
          <div className="flex items-center gap-4 text-[11px]">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {companies.filter((c) => c.status === "Ativo").length} Ativas
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
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
