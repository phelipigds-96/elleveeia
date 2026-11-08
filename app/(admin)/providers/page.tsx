import { requirePlatformAdmin } from "@/lib/services/platform/admin"
import { getPlatformProvidersData } from "@/lib/services/platform/providers"
import ProvidersClientView from "@/components/providers/providers-client-view"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdminProvidersPage() {
  try {
    await requirePlatformAdmin()
  } catch (err: any) {
    console.warn("[ProvidersPage] Acesso não-operador à visualização de provedores:", err?.message)
  }

  const { providers, infraConfig } = await getPlatformProvidersData()

  return (
    <ProvidersClientView
      initialProviders={providers}
      infraConfig={infraConfig}
    />
  )
}
