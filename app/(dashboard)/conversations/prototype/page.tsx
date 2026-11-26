import { FluentWorkspacePrototype } from "./components/fluent-workspace-prototype"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Protótipo Fluent Inspired | Ellevee IA",
  description: "Protótipo visual isolado para aprovação da UI-02 (Ellevee Workspace — Fluent Inspired)",
}

export default async function ConversationsPrototypePage({
  searchParams,
}: {
  searchParams?: Promise<{ mode?: string }>
}) {
  const resolved = await searchParams
  const rawMode = resolved?.mode
  const initialMode =
    rawMode === "desktop" ||
    rawMode === "mobile_list" ||
    rawMode === "mobile_chat" ||
    rawMode === "mobile_sheet"
      ? rawMode
      : "gallery"

  return <FluentWorkspacePrototype initialMode={initialMode} />
}
