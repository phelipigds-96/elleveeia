"use client"

import React, { useState } from "react"
import CompaniesHeader from "@/components/companies/companies-header"
import CompaniesTable from "@/components/companies/companies-table"
import CompanyForm from "@/components/companies/company-form"
import { INITIAL_MOCK_COMPANIES, CompanyMock } from "@/components/companies/mock-companies"

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<CompanyMock[]>(INITIAL_MOCK_COMPANIES)
  const [openCreate, setOpenCreate] = useState(false)

  const handleCreateCompany = (newCompany: Partial<CompanyMock>) => {
    const fullCompany: CompanyMock = {
      id: String(Date.now()),
      name: newCompany.name || "Nova Empresa",
      slug: newCompany.slug || "nova-empresa",
      cnpj: newCompany.cnpj || "00.000.000/0001-00",
      plan: newCompany.plan || "Pro",
      status: "Ativo",
      agentsCount: newCompany.agentsCount || 1,
      maxAgents: newCompany.maxAgents || 5,
      messagesUsed: 0,
      messagesLimit: newCompany.messagesLimit || 25000,
      tokensUsed: 0,
      tokensLimit: newCompany.tokensLimit || 2000000,
      aiProvider: newCompany.aiProvider || "openai",
      createdAt: new Date().toISOString().split("T")[0],
      adminEmail: newCompany.adminEmail || "admin@empresa.com",
    }
    setCompanies((prev) => [fullCompany, ...prev])
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
      <CompaniesTable companies={companies} onUpdateCompany={handleUpdateCompany} />
      <CompanyForm
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        onSave={handleCreateCompany}
      />
    </div>
  )
}
