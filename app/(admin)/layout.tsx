import React from "react"
import { redirect } from "next/navigation"
import AdminShell from "@/components/admin/admin-shell"
import { requirePlatformAdmin } from "@/lib/services/platform/admin"

export const metadata = {
  title: "SuperAdmin | Ellevee IA",
  description: "Painel de Controle e Governança Multi-Tenant da Ellevee IA",
}

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  try {
    await requirePlatformAdmin()
  } catch (err: any) {
    if (err?.statusCode === 401) {
      redirect("/login")
    }
    redirect("/dashboard")
  }

  return <AdminShell>{children}</AdminShell>
}
