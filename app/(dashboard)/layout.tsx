import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { Toaster } from '@/components/ui/toast'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-ellevee-ivory text-ellevee-ink flex antialiased font-sans selection:bg-ellevee-accent selection:text-ellevee-ink">
      <Sidebar />
      <div className="flex flex-col w-full flex-1 min-w-0">
        <Header />
        <main className="flex-1 overflow-auto bg-ellevee-ivory p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>

      {/* Toaster Global de Notificações */}
      <Toaster />
    </div>
  )
}
