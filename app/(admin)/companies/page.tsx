import React from "react"
import { getCompaniesList } from "./actions"
import CompaniesClientView from "@/components/companies/companies-client-view"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata = {
  title: "Empresas & Tenants | SuperAdmin Ellevee IA",
  description: "Diretório administrativo de organizações, limites e governança multi-tenant.",
}

export default async function CompaniesPage() {
  const companies = await getCompaniesList()

  return <CompaniesClientView initialCompanies={companies} />
}
