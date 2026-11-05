"use client"

import React, { useState, useEffect } from "react"
import CompaniesHeader from "@/components/companies/companies-header"
import CompaniesTable from "@/components/companies/companies-table"
import CompanyForm from "@/components/companies/company-form"
import { CompanyMock } from "@/components/companies/mock-companies"

interface CompaniesClientViewProps {
  initialCompanies: CompanyMock[]
}

export default function CompaniesClientView({ initialCompanies }: CompaniesClientViewProps) {
  const [companies, setCompanies] = useState<CompanyMock[]>(initialCompanies)
  const [openCreate, setOpenCreate] = useState(false)

  // Atualiza estado local quando o Server Component revalida
  useEffect(() => {
    setCompanies(initialCompanies)
  }, [initialCompanies])

  const handleCreateCompanySuccess = (newCompany: Partial<CompanyMock>) => {
    // Adiciona otimisticamente caso o revalidatePath demore alguns milissegundos
    if (newCompany.id) {
      setCompanies((prev) => {
        if (prev.some((c) => c.id === newCompany.id)) return prev
        const complete: CompanyMock = {
          id: newCompany.id!,
          name: newCompany.name || "Nova Organização",
          slug: newCompany.slug || "nova-org",
          cnpj: newCompany.cnpj || "00.000.000/0001-00",
          plan: newCompany.plan || "Pro",
          status: newCompany.status || "Ativo",
          agentsCount: 1,
          maxAgents: newCompany.plan === "Enterprise" ? 15 : newCompany.plan === "Pro" ? 5 : 2,
          messagesUsed: 0,
          messagesLimit: newCompany.plan === "Enterprise" ? 100000 : newCompany.plan === "Pro" ? 25000 : 5000,
          tokensUsed: 0,
          tokensLimit: 2000000,
          aiProvider: newCompany.aiProvider || "openai",
          createdAt: new Date().toISOString().split("T")[0],
          adminEmail: newCompany.adminEmail || `admin@${newCompany.slug}.com`,
        }
        return [complete, ...prev]
      })
    }
  }

  const handleUpdateCompany = (updated: CompanyMock) => {
    setCompanies((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
  }

  const activeCount = companies.filter((c) => c.status === "Ativo").length
  const trialCount = companies.filter((c) => c.plan === "Trial").length
  const suspendedCount = companies.filter((c) => c.status === "Suspenso").length

  return (
    <div className="space-y-6">
      <CompaniesHeader
        onCreate={() => setOpenCreate(true)}
        totalCount={companies.length}
        activeCount={activeCount}
        trialCount={trialCount}
        suspendedCount={suspendedCount}
      />

      <CompaniesTable
        companies={companies}
        onUpdateCompany={handleUpdateCompany}
      />

      <CompanyForm
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        onSave={handleCreateCompanySuccess}
      />
    </div>
  )
}
