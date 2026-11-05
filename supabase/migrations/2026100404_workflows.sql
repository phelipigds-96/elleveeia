-- Migration: 20261004_workflows.sql
-- Fase 10: Central de Conversas e Workflows Kanban

CREATE TABLE IF NOT EXISTS public.workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.workflow_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    stage_type TEXT NOT NULL DEFAULT 'in_progress', -- 'initial', 'in_progress', 'final'
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Adicionar associação de workflow nas conversas
ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS workflow_id UUID REFERENCES public.workflows(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS workflow_stage_id UUID REFERENCES public.workflow_stages(id) ON DELETE SET NULL;

-- Índices
CREATE INDEX IF NOT EXISTS idx_workflows_company_id ON public.workflows(company_id);
CREATE INDEX IF NOT EXISTS idx_workflow_stages_workflow_id ON public.workflow_stages(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_stages_company_id ON public.workflow_stages(company_id);
CREATE INDEX IF NOT EXISTS idx_conversations_workflow_id ON public.conversations(workflow_id);
CREATE INDEX IF NOT EXISTS idx_conversations_workflow_stage_id ON public.conversations(workflow_stage_id);

-- RLS Workflows
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários veem workflows de suas empresas"
    ON public.workflows FOR SELECT
    USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Usuários inserem workflows em suas empresas"
    ON public.workflows FOR INSERT
    WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Usuários atualizam workflows de suas empresas"
    ON public.workflows FOR UPDATE
    USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Usuários deletam workflows de suas empresas"
    ON public.workflows FOR DELETE
    USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

-- RLS Workflow Stages
ALTER TABLE public.workflow_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários veem stages de suas empresas"
    ON public.workflow_stages FOR SELECT
    USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Usuários inserem stages em suas empresas"
    ON public.workflow_stages FOR INSERT
    WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Usuários atualizam stages de suas empresas"
    ON public.workflow_stages FOR UPDATE
    USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Usuários deletam stages de suas empresas"
    ON public.workflow_stages FOR DELETE
    USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

-- Triggers for updated_at
CREATE TRIGGER trg_workflows_updated_at
BEFORE UPDATE ON public.workflows
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_workflow_stages_updated_at
BEFORE UPDATE ON public.workflow_stages
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Se a empresa não tiver um workflow padrão, o primeiro criado se torna padrão.
-- Para garantir consistência nos testes e sistema legado, as conversas antigas 
-- manterão status de texto, mas as novas devem entrar no workflow padrão (se existir).
