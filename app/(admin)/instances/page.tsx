import React from "react"
import { getAdminInstancesDataAction } from "./actions"
import InstancesClientView from "./components/instances-client-view"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata = {
  title: "Instâncias WhatsApp | SuperAdmin Ellevee IA",
  description: "Gerenciamento administrativo centralizado de instâncias e gateway Evolution API.",
}

export default async function InstancesPage() {
  const data = await getAdminInstancesDataAction()

  return <InstancesClientView initialData={data} />
}
