-- Adiciona coluna `provider` na tabela agents
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'openai';

-- Adiciona coluna `provider` na tabela agent_runs
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'openai';
