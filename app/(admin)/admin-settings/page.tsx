import React from "react"
import { getOperationalTelemetry } from "@/lib/services/platform/observability"
import { getTenantGovernanceReport } from "@/lib/services/platform/tenant-governance"
import AdminObservabilityClient from "@/components/admin/admin-observability-client"
import AdminGovernancePanel from "@/components/admin/admin-governance-panel"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata = {
  title: "Configurações & Observabilidade | SuperAdmin Ellevee IA",
  description:
    "Telemetria em tempo real do worker cron, governança de custos/quotas e rastreamento end-to-end.",
}

export default async function AdminSettingsPage() {
  const [telemetry, governance] = await Promise.all([
    getOperationalTelemetry({ cronLimit: 25, dlqLimit: 30 }),
    getTenantGovernanceReport({ daysWindow: 30 }),
  ])

  return (
    <div className="space-y-8">
      <AdminObservabilityClient initialTelemetry={telemetry} />
      <AdminGovernancePanel initialGovernance={governance} />
    </div>
  )
}
