import { requirePlatformAdmin } from "@/lib/services/platform/admin"
import { getPlatformPlans } from "@/lib/services/platform/plans"
import PlansClientView from "@/components/plans/plans-client-view"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function PlansPage() {
  await requirePlatformAdmin()
  const plans = await getPlatformPlans()

  return <PlansClientView initialPlans={plans} />
}
