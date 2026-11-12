import React from "react"
import { getOperationalTelemetry } from "@/lib/services/platform/observability"
import AdminObservabilityClient from "@/components/admin/admin-observability-client"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata = {
  title: "Configurações & Observabilidade | SuperAdmin Ellevee IA",
  description: "Telemetria em tempo real do worker cron, saúde do motor e Dead Letter Queue.",
}

export default async function AdminSettingsPage() {
  const telemetry = await getOperationalTelemetry({ cronLimit: 25, dlqLimit: 30 })

  return <AdminObservabilityClient initialTelemetry={telemetry} />
}
