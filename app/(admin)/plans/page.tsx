import { requirePlatformAdmin } from "@/lib/services/platform/admin"
import { getPlatformPlans } from "@/lib/services/platform/plans"
import PlansClientView from "@/components/plans/plans-client-view"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function PlansPage() {
  try {
    await requirePlatformAdmin()
  } catch (err: any) {
    console.warn("[PlansPage] Acesso não-operador à visualização de planos:", err?.message)
  }

  const plans = await getPlatformPlans()

  return <PlansClientView initialPlans={plans} />
}
