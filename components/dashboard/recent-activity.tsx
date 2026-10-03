import { Clock } from "lucide-react"

export function RecentActivity({ items = [] }: { items?: any[] }) {
  if (!items || items.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        Nenhuma atividade recente.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-4">
          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
            <Clock className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium leading-none">{item.title}</p>
            <p className="text-xs text-muted-foreground">{item.time}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
