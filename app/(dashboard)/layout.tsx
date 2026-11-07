import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { Toaster } from '@/components/ui/toast'
import { getImpersonateStatus } from '@/app/(admin)/companies/actions'
import { ImpersonateBanner } from '@/components/admin/impersonate-banner'
import { getCurrentUserProfile } from '@/lib/services/auth/guard'

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
  const userRole = impersonate.isImpersonating ? 'admin' : (profile?.role || 'admin')

  return (
    <div className="h-screen overflow-hidden bg-ellevee-ivory text-ellevee-ink flex flex-col antialiased font-sans selection:bg-ellevee-accent selection:text-ellevee-ink">
      {impersonate.isImpersonating && (
        <ImpersonateBanner
          companyName={impersonate.targetCompanyName || "Organização Alvo"}
          companySlug={impersonate.targetCompanySlug || ""}
        />
      )}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar userRole={userRole} />
        <div className="flex flex-col w-full flex-1 min-w-0 h-full min-h-0">
          <Header userRole={userRole} />
          <main className="flex flex-1 flex-col min-h-0 overflow-auto bg-ellevee-ivory p-4 sm:p-6 lg:p-8">
            {children}
          </main>
        </div>
      </div>

      {/* Toaster Global de Notificações */}
      <Toaster />
    </div>
  )
}
