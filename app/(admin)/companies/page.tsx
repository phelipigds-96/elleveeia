import React from "react"
import { getCompaniesList } from "./actions"
import CompaniesClientView from "@/components/companies/companies-client-view"
import { requirePlatformAdmin } from "@/lib/services/platform/admin"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata = {
  title: "Empresas & Tenants | SuperAdmin Ellevee IA",
  description: "Diretório administrativo de organizações, limites e governança multi-tenant.",
}

export default async function CompaniesPage() {
  await requirePlatformAdmin()
  const companies = await getCompaniesList()

  return <CompaniesClientView initialCompanies={companies} />
}
