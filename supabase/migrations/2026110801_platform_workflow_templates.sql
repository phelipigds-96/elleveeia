-- ==============================================================================
-- Migration: 2026110801_platform_workflow_templates.sql
-- Descrição: Tabela para persistência dinâmica de Modelos de Funil Kanban (Blueprints),
--            permitindo criação, edição e reutilização de fluxos por nicho/segmento.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.platform_workflow_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    segment TEXT NOT NULL,
    badge_text TEXT,
    is_system BOOLEAN NOT NULL DEFAULT false,
    stages JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Trigger de updated_at
CREATE OR REPLACE FUNCTION public.handle_platform_workflow_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_platform_workflow_templates_updated_at ON public.platform_workflow_templates;
CREATE TRIGGER trg_platform_workflow_templates_updated_at
BEFORE UPDATE ON public.platform_workflow_templates
FOR EACH ROW EXECUTE FUNCTION public.handle_platform_workflow_templates_updated_at();

-- Habilitar RLS
ALTER TABLE public.platform_workflow_templates ENABLE ROW LEVEL SECURITY;

-- 1. Leitura permitida para todos os usuários autenticados (para que empresas possam selecionar modelos) e service_role
DROP POLICY IF EXISTS "Leitura de templates para usuarios autenticados" ON public.platform_workflow_templates;
CREATE POLICY "Leitura de templates para usuarios autenticados"
    ON public.platform_workflow_templates FOR SELECT
    TO authenticated, service_role
    USING (true);

-- 2. Modificações permitidas apenas para service_role (gerenciadas via Server Actions do SuperAdmin)
DROP POLICY IF EXISTS "Modificacoes de templates restritas a service_role" ON public.platform_workflow_templates;
CREATE POLICY "Modificacoes de templates restritas a service_role"
    ON public.platform_workflow_templates FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Seed dos 4 modelos nativos da plataforma + Modelo de Streaming & Assinaturas
INSERT INTO public.platform_workflow_templates (key, label, description, segment, badge_text, is_system, stages)
VALUES 
(
    'retail_food',
    'Varejo & Confeitaria (ex: Sumel)',
    'Fluxo ágil focado em pedidos de catálogo, confirmação de Pix, separação na cozinha/estoque e entrega/retirada.',
    'Varejo Alimentício & Delivery',
    'Recomendado para Lojas & Docerias',
    true,
    '[
        {"name": "Novo Contato / Cardápio", "description": "Primeira interação do cliente e envio do catálogo/cardápio", "stage_type": "initial", "handled_by": "ai", "color": "#eab308"},
        {"name": "Orçamento em Aberto", "description": "Carrinho em montagem ou tirando dúvidas de produtos e gramaturas", "stage_type": "in_progress", "handled_by": "ai", "color": "#f97316"},
        {"name": "Aguardando Pagamento (Pix)", "description": "Chave Pix/código enviado, aguardando envio do comprovante", "stage_type": "in_progress", "handled_by": "waiting", "color": "#a855f7"},
        {"name": "Em Separação / Cozinha", "description": "Pagamento confirmado; pedido sendo separado no estoque ou preparado", "stage_type": "in_progress", "handled_by": "human", "color": "#3b82f6"},
        {"name": "Saiu para Entrega / Retirada", "description": "Entregador em trânsito ou pacote pronto para retirada no balcão", "stage_type": "in_progress", "handled_by": "human", "color": "#06b6d4"},
        {"name": "Pedido Concluído", "description": "Mercadoria entregue com sucesso e atendimento finalizado", "stage_type": "final", "handled_by": "human", "color": "#22c55e"}
    ]'::jsonb
),
(
    'events_party',
    'Salão de Festas & Eventos',
    'Gestão de datas comemorativas, verificação de disponibilidade de agenda, visitas e fechamento de contratos.',
    'Eventos & Buffets',
    'Eventos & Espaços',
    true,
    '[
        {"name": "Primeiro Contato", "description": "Interesse inicial sobre datas, pacotes e capacidades do espaço", "stage_type": "initial", "handled_by": "ai", "color": "#eab308"},
        {"name": "Data Disponível", "description": "Data do evento pré-verificada com pacote de interesse identificado", "stage_type": "in_progress", "handled_by": "ai", "color": "#f97316"},
        {"name": "Visita / Degustação Agendada", "description": "Reunião presencial marcada no salão para conhecer o espaço", "stage_type": "in_progress", "handled_by": "human", "color": "#a855f7"},
        {"name": "Proposta Enviada", "description": "Orçamento formal e minuta de contrato encaminhados ao cliente", "stage_type": "in_progress", "handled_by": "human", "color": "#3b82f6"},
        {"name": "Contrato Fechado", "description": "Sinal pago e contrato assinado para a data reservada", "stage_type": "final", "handled_by": "human", "color": "#22c55e"},
        {"name": "Data Indisponível / Perdido", "description": "Data já ocupada ou cliente optou por outro fornecedor", "stage_type": "final", "handled_by": "human", "color": "#ef4444"}
    ]'::jsonb
),
(
    'dental_clinic',
    'Clínica Odontológica & Saúde',
    'Triagem preliminar por especialidade, agendamento de consultas, confirmação prévia e acompanhamento pós-tratamento.',
    'Saúde & Odontologia',
    'Clínicas & Consultórios',
    true,
    '[
        {"name": "Triagem & Dúvidas", "description": "Acolhimento com identificação da queixa ou especialidade desejada", "stage_type": "initial", "handled_by": "ai", "color": "#eab308"},
        {"name": "Agendamento em Andamento", "description": "Negociação de horários e dias disponíveis na grade dos dentistas", "stage_type": "in_progress", "handled_by": "ai", "color": "#06b6d4"},
        {"name": "Consulta Agendada", "description": "Horário confirmado na agenda médica; aguardando a data", "stage_type": "in_progress", "handled_by": "waiting", "color": "#3b82f6"},
        {"name": "Lembrete / Confirmação 24h", "description": "Secretaria confirmando presença na véspera da consulta", "stage_type": "in_progress", "handled_by": "human", "color": "#a855f7"},
        {"name": "Tratamento Concluído", "description": "Consulta realizada e plano de manutenção ou encerramento arquivado", "stage_type": "final", "handled_by": "human", "color": "#22c55e"}
    ]'::jsonb
),
(
    'general_services',
    'Serviços & B2B Geral',
    'Pipeline tradicional para empresas de serviços, consultorias e empresas de prestação com proposta técnica.',
    'Serviços & Negócios',
    'Padrão Multiuso',
    true,
    '[
        {"name": "Entrada / Qualificação", "description": "Primeiro contato e qualificação de interesse", "stage_type": "initial", "handled_by": "ai", "color": "#eab308"},
        {"name": "Em Negociação", "description": "Consultor ou vendedor apresentando soluções e valores", "stage_type": "in_progress", "handled_by": "human", "color": "#3b82f6"},
        {"name": "Aguardando Cliente", "description": "Aguardando retorno do cliente ou aprovação interna", "stage_type": "in_progress", "handled_by": "waiting", "color": "#a855f7"},
        {"name": "Finalizado / Ganho", "description": "Negócio fechado e projeto iniciado com sucesso", "stage_type": "final", "handled_by": "human", "color": "#22c55e"},
        {"name": "Arquivado / Perdido", "description": "Proposta recusada ou oportunidade desqualificada", "stage_type": "final", "handled_by": "human", "color": "#ef4444"}
    ]'::jsonb
),
(
    'streaming_subscriptions',
    'Streaming & Assinaturas Digitais',
    'Funil voltado para serviços de streaming, IPTV e planos recorrentes com teste grátis, confirmação de Pix e renovação periódica.',
    'Serviços Digitais & Recorrência',
    'Streaming & Mídias',
    false,
    '[
        {"name": "Novo Contato / Teste Grátis", "description": "Primeira mensagem do cliente interessado e envio automático de link de teste ou instruções de aplicativo", "stage_type": "initial", "handled_by": "ai", "color": "#eab308"},
        {"name": "Teste em Andamento", "description": "Cliente realizando o teste do serviço; IA monitora qualidade e tira dúvidas técnicas", "stage_type": "in_progress", "handled_by": "waiting", "color": "#06b6d4"},
        {"name": "Aguardando Pagamento (Pix)", "description": "Planos e chave Pix enviados, aguardando envio do comprovante para ativação definitiva", "stage_type": "in_progress", "handled_by": "waiting", "color": "#a855f7"},
        {"name": "Assinatura Ativa", "description": "Pagamento confirmado; dados de acesso definitivos entregues e serviço liberado", "stage_type": "in_progress", "handled_by": "human", "color": "#3b82f6"},
        {"name": "Cobrança de Renovação", "description": "Lembrete preventivo próximo ao vencimento da mensalidade para retenção", "stage_type": "in_progress", "handled_by": "ai", "color": "#f97316"},
        {"name": "Renovado / Concluído", "description": "Mensalidade quitada ou ciclo de assinatura mantido com sucesso", "stage_type": "final", "handled_by": "human", "color": "#22c55e"},
        {"name": "Cancelado / Expirado", "description": "Cliente optou por não renovar ou teste expirou sem conversão", "stage_type": "final", "handled_by": "human", "color": "#ef4444"}
    ]'::jsonb
)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    segment = EXCLUDED.segment,
    badge_text = EXCLUDED.badge_text,
    stages = EXCLUDED.stages;
