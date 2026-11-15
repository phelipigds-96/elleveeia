import { requirePlatformAdmin } from "@/lib/services/platform/admin"
import { getPlatformProvidersData } from "@/lib/services/platform/providers"
import ProvidersClientView from "@/components/providers/providers-client-view"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdminProvidersPage() {
  await requirePlatformAdmin()
  const { providers, infraConfig } = await getPlatformProvidersData()

  return (
    <ProvidersClientView
      initialProviders={providers}
      infraConfig={infraConfig}
    />
  )
}
