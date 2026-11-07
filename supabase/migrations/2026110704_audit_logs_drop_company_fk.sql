-- ==============================================================================
-- Migration: 2026110704_audit_logs_drop_company_fk.sql
-- Desacopla a chave estrangeira de target_company_id em platform_audit_logs.
--
-- Motivação Arquitetural:
-- Em sistemas de auditoria corporativa imutáveis, logs de auditoria nunca devem
-- ser atualizados ou excluídos em cascata (ON DELETE CASCADE / SET NULL) quando
-- um tenant é removido ou limpo da base. O UUID histórico deve permanecer preservado
-- no log sem dependência de integridade relacional restritiva.
-- ==============================================================================

ALTER TABLE public.platform_audit_logs
  DROP CONSTRAINT IF EXISTS platform_audit_logs_target_company_id_fkey;

-- Remove a empresa de teste remanescente (Coala Test Organização)
DELETE FROM public.companies WHERE slug LIKE 'coala-test%';
