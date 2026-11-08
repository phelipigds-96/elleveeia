import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { Toaster } from "@/components/ui/toast"
import { getImpersonateStatus } from "@/app/(admin)/companies/actions"
import { ImpersonateBanner } from "@/components/admin/impersonate-banner"
import { getCurrentUserProfile } from "@/lib/services/auth/guard"
import { createClient } from "@/lib/supabase/server"
import { DashboardShell } from "@/components/layout/dashboard-shell"

export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [impersonate, profile] = await Promise.all([
    getImpersonateStatus(),
    getCurrentUserProfile(),
  ])

  // Se estiver em modo Impersonate do SuperAdmin, opera com poderes de Admin
  const userRole = impersonate.isImpersonating ? "admin" : (profile?.role || "admin")

  let companyName = "Ellevee IA"
  if (profile?.company_id) {
    try {
      const supabase = createClient()
      const { data: comp } = await supabase
        .from("companies")
        .select("name")
        .eq("id", profile.company_id)
        .maybeSingle()
      if (comp?.name) companyName = comp.name
    } catch {}
  }
  if (impersonate.isImpersonating && impersonate.targetCompanyName) {
    companyName = impersonate.targetCompanyName
  }

  const userDisplayName = profile?.full_name || (userRole === "attendant" ? "Atendente" : "Administrador")

  return (
    <div className="h-screen overflow-hidden bg-ellevee-ivory text-ellevee-ink flex flex-col antialiased font-sans selection:bg-ellevee-accent selection:text-ellevee-ink">
      {impersonate.isImpersonating && (
        <ImpersonateBanner
          companyName={impersonate.targetCompanyName || "Organização Alvo"}
          companySlug={impersonate.targetCompanySlug || ""}
        />
      )}
      <DashboardShell
        userRole={userRole}
        impersonate={impersonate}
        companyName={companyName}
        userDisplayName={userDisplayName}
        standardSidebar={<Sidebar userRole={userRole} />}
        standardHeader={<Header userRole={userRole} />}
      >
        {children}
      </DashboardShell>

      {/* Toaster Global de Notificações */}
      <Toaster />
    </div>
  )
}
