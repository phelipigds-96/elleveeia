import React from "react"
import AdminShell from "@/components/admin/admin-shell"

export const metadata = {
  title: "SuperAdmin | Ellevee IA",
  description: "Painel de Controle e Governança Multi-Tenant da Ellevee IA",
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AdminShell>{children}</AdminShell>
}
