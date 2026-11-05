import dynamic from 'next/dynamic'
import PainelClient from './components/painel-client'

export default function ConversationsPage() {
  // Página de demonstração visual do Painel de Atendimento.
  // Usa apenas mocks locais e não faz chamadas ao backend.
  return (
    <div className="h-[100vh] w-full">
      <PainelClient />
    </div>
  )
}
