interface ChartDataPoint {
  label: string
  value: number
}

// Exemplos visuais estáticos solicitados (apenas como placeholder enquanto não há dados reais)
// Na aplicação real, o componente pai passa os dados ou o array vem zerado
export function ActivityChart({ data = [] }: { data?: ChartDataPoint[] }) {
  
  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-sm text-muted-foreground border-t pt-6 mt-4 border-dashed">
        <p>Suas conversas aparecerão aqui quando o agente começar a atender clientes.</p>
      </div>
    )
  }

  const maxValue = Math.max(...data.map(d => d.value), 1) // Garante que não divide por 0

  return (
    <div className="flex flex-col w-full">
      <div className="flex items-end justify-between h-48 w-full gap-2 pt-6">
        {data.map((item, i) => {
          const heightPercentage = Math.round((item.value / maxValue) * 100)
          
          return (
            <div key={i} className="flex flex-col items-center flex-1 gap-2 group">
              {/* Tooltip rudimentar hover */}
              <span className="text-xs font-medium text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                {item.value}
              </span>
              
              <div className="w-full relative bg-muted rounded-t-sm flex items-end justify-center" style={{ height: '100%' }}>
                <div 
                  className="w-full bg-primary/80 hover:bg-primary transition-all rounded-t-sm"
                  style={{ height: `${heightPercentage}%` }}
                />
              </div>
              
              <span className="text-xs text-muted-foreground truncate w-full text-center">
                {item.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
