export interface StageTemplate {
  name: string
  description?: string
  stage_type: 'initial' | 'in_progress' | 'final'
  handled_by: 'ai' | 'human' | 'waiting'
  color: string
}

export interface WorkflowTemplate {
  key: string
  label: string
  description: string
  segment: string
  badgeText: string
  stages: StageTemplate[]
}

export interface SaveStagesInput {
  name: string
  description?: string | null
  stage_type: 'initial' | 'in_progress' | 'final'
  handled_by: 'ai' | 'human' | 'waiting'
  color: string
}

export type TemplateStageType = 'initial' | 'in_progress' | 'final'
export type TemplateHandledBy = 'ai' | 'human' | 'waiting'
export type WorkflowTemplateStage = StageTemplate

export const DEFAULT_WORKFLOW_STAGES = [
  { name: 'Novo Contato', stage_type: 'initial' as const, position: 0, color: '#eab308', handled_by: 'ai' as const },
  { name: 'Em Atendimento', stage_type: 'in_progress' as const, position: 1, color: '#3b82f6', handled_by: 'human' as const },
  { name: 'Finalizado', stage_type: 'final' as const, position: 2, color: '#22c55e', handled_by: 'human' as const }
] as const

export const WORKFLOW_TEMPLATES: Record<string, WorkflowTemplate> = {
  retail_food: {
    key: 'retail_food',
    label: 'Varejo & Confeitaria (ex: Sumel)',
    description: 'Fluxo ágil focado em pedidos de catálogo, confirmação de Pix, separação na cozinha/estoque e entrega/retirada.',
    segment: 'Varejo Alimentício & Delivery',
    badgeText: 'Recomendado para Lojas & Docerias',
    stages: [
      {
        name: 'Novo Contato / Cardápio',
        description: 'Primeira interação do cliente e envio do catálogo/cardápio',
        stage_type: 'initial',
        handled_by: 'ai',
        color: '#eab308' // Amarelo
      },
      {
        name: 'Orçamento em Aberto',
        description: 'Carrinho em montagem ou tirando dúvidas de produtos e gramaturas',
        stage_type: 'in_progress',
        handled_by: 'ai',
        color: '#f97316' // Laranja
      },
      {
        name: 'Aguardando Pagamento (Pix)',
        description: 'Chave Pix/código enviado, aguardando envio do comprovante',
        stage_type: 'in_progress',
        handled_by: 'waiting',
        color: '#a855f7' // Roxo
      },
      {
        name: 'Em Separação / Cozinha',
        description: 'Pagamento confirmado; pedido sendo separado no estoque ou preparado',
        stage_type: 'in_progress',
        handled_by: 'human',
        color: '#3b82f6' // Azul
      },
      {
        name: 'Saiu para Entrega / Retirada',
        description: 'Entregador em trânsito ou pacote pronto para retirada no balcão',
        stage_type: 'in_progress',
        handled_by: 'human',
        color: '#06b6d4' // Ciano
      },
      {
        name: 'Pedido Concluído',
        description: 'Mercadoria entregue com sucesso e atendimento finalizado',
        stage_type: 'final',
        handled_by: 'human',
        color: '#22c55e' // Verde
      }
    ]
  },

  events_party: {
    key: 'events_party',
    label: 'Salão de Festas & Eventos',
    description: 'Gestão de datas comemorativas, verificação de disponibilidade de agenda, visitas e fechamento de contratos.',
    segment: 'Eventos & Buffets',
    badgeText: 'Eventos & Espaços',
    stages: [
      {
        name: 'Primeiro Contato',
        description: 'Interesse inicial sobre datas, pacotes e capacidades do espaço',
        stage_type: 'initial',
        handled_by: 'ai',
        color: '#eab308'
      },
      {
        name: 'Data Disponível',
        description: 'Data do evento pré-verificada com pacote de interesse identificado',
        stage_type: 'in_progress',
        handled_by: 'ai',
        color: '#f97316'
      },
      {
        name: 'Visita / Degustação Agendada',
        description: 'Reunião presencial marcada no salão para conhecer o espaço',
        stage_type: 'in_progress',
        handled_by: 'human',
        color: '#a855f7'
      },
      {
        name: 'Proposta Enviada',
        description: 'Orçamento formal e minuta de contrato encaminhados ao cliente',
        stage_type: 'in_progress',
        handled_by: 'human',
        color: '#3b82f6'
      },
      {
        name: 'Contrato Fechado',
        description: 'Sinal pago e contrato assinado para a data reservada',
        stage_type: 'final',
        handled_by: 'human',
        color: '#22c55e'
      },
      {
        name: 'Data Indisponível / Perdido',
        description: 'Data já ocupada ou cliente optou por outro fornecedor',
        stage_type: 'final',
        handled_by: 'human',
        color: '#ef4444' // Vermelho
      }
    ]
  },

  dental_clinic: {
    key: 'dental_clinic',
    label: 'Clínica Odontológica & Saúde',
    description: 'Triagem preliminar por especialidade, agendamento de consultas, confirmação prévia e acompanhamento pós-tratamento.',
    segment: 'Saúde & Odontologia',
    badgeText: 'Clínicas & Consultórios',
    stages: [
      {
        name: 'Triagem & Dúvidas',
        description: 'Acolhimento com identificação da queixa ou especialidade desejada',
        stage_type: 'initial',
        handled_by: 'ai',
        color: '#eab308'
      },
      {
        name: 'Agendamento em Andamento',
        description: 'Negociação de horários e dias disponíveis na grade dos dentistas',
        stage_type: 'in_progress',
        handled_by: 'ai',
        color: '#06b6d4'
      },
      {
        name: 'Consulta Agendada',
        description: 'Horário confirmado na agenda médica; aguardando a data',
        stage_type: 'in_progress',
        handled_by: 'waiting',
        color: '#3b82f6'
      },
      {
        name: 'Lembrete / Confirmação 24h',
        description: 'Secretaria confirmando presença na véspera da consulta',
        stage_type: 'in_progress',
        handled_by: 'human',
        color: '#a855f7'
      },
      {
        name: 'Tratamento Concluído',
        description: 'Consulta realizada e plano de manutenção ou encerramento arquivado',
        stage_type: 'final',
        handled_by: 'human',
        color: '#22c55e'
      }
    ]
  },

  general_services: {
    key: 'general_services',
    label: 'Serviços & B2B Geral',
    description: 'Pipeline tradicional para empresas de serviços, consultorias e empresas de prestação com proposta técnica.',
    segment: 'Serviços & Negócios',
    badgeText: 'Padrão Multiuso',
    stages: [
      {
        name: 'Entrada / Qualificação',
        description: 'Primeiro contato e qualificação de interesse',
        stage_type: 'initial',
        handled_by: 'ai',
        color: '#eab308'
      },
      {
        name: 'Em Negociação',
        description: 'Consultor ou vendedor apresentando soluções e valores',
        stage_type: 'in_progress',
        handled_by: 'human',
        color: '#3b82f6'
      },
      {
        name: 'Aguardando Cliente',
        description: 'Aguardando retorno do cliente ou aprovação interna',
        stage_type: 'in_progress',
        handled_by: 'waiting',
        color: '#a855f7'
      },
      {
        name: 'Finalizado / Ganho',
        description: 'Negócio fechado e projeto iniciado com sucesso',
        stage_type: 'final',
        handled_by: 'human',
        color: '#22c55e'
      },
      {
        name: 'Arquivado / Perdido',
        description: 'Proposta recusada ou oportunidade desqualificada',
        stage_type: 'final',
        handled_by: 'human',
        color: '#ef4444'
      }
    ]
  }
}

export function getWorkflowTemplate(templateKey: string): WorkflowTemplate | null {
  if (!templateKey) return null
  return WORKFLOW_TEMPLATES[templateKey.trim()] || null
}
