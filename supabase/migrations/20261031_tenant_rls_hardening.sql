-- ==============================================================================
-- Migration: 20261031_tenant_rls_hardening.sql
-- Etapa 8.2: Blindagem do RLS, proteção de perfis e defesa em profundidade no banco
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. FUNÇÕES AUXILIARES DE TENANT E PAPEL (SEM RECURSÃO DE RLS)
-- ------------------------------------------------------------------------------

-- Função segura para obter o company_id do usuário autenticado sem provocar recursão de RLS
CREATE OR REPLACE FUNCTION public.get_auth_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT company_id
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_auth_company_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_auth_company_id() TO authenticated, service_role;

-- Função segura para validar se o usuário autenticado possui perfil de Administrador
CREATE OR REPLACE FUNCTION public.is_company_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'owner')
  );
$$;

REVOKE ALL ON FUNCTION public.is_company_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_company_admin() TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- 2. PROTEÇÃO CRÍTICA DA TABELA PROFILES (TRIGGER DE IMUTABILIDADE DE TENANT/ROLE)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_profile_tenant_and_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Permite alterações irrestritas apenas pelo Service Role (rotinas administrativas de backend)
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Impede alteração de id (identificador do auth.users)
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Operação negada: não é permitido alterar o identificador do perfil (id).';
  END IF;

  -- Impede migração para outro tenant (company_id)
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'Operação negada: não é permitido alterar o vínculo de empresa (company_id).';
  END IF;

  -- Impede auto-elevação de privilégio (role)
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Operação negada: não é permitido alterar o papel de permissão (role).';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_tenant_and_role ON public.profiles;
CREATE TRIGGER trg_protect_profile_tenant_and_role
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_tenant_and_role();


-- ------------------------------------------------------------------------------
-- 3. ATUALIZAÇÃO DAS POLÍTICAS RLS DE PROFILES E COMPANIES
-- ------------------------------------------------------------------------------

-- Tabela: profiles
DROP POLICY IF EXISTS "Users can view profiles in their company" ON public.profiles;
CREATE POLICY "Users can view profiles in their company" 
  ON public.profiles FOR SELECT 
  USING ( company_id = public.get_auth_company_id() );

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" 
  ON public.profiles FOR UPDATE 
  USING ( id = auth.uid() )
  WITH CHECK ( id = auth.uid() AND company_id = public.get_auth_company_id() );

DROP POLICY IF EXISTS "Admins can insert profiles in their company" ON public.profiles;
CREATE POLICY "Admins can insert profiles in their company"
  ON public.profiles FOR INSERT
  WITH CHECK ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

-- Tabela: companies
DROP POLICY IF EXISTS "Users can view their own company" ON public.companies;
CREATE POLICY "Users can view their own company" 
  ON public.companies FOR SELECT 
  USING ( id = public.get_auth_company_id() );

DROP POLICY IF EXISTS "Users can update their own company" ON public.companies;
CREATE POLICY "Users can update their own company" 
  ON public.companies FOR UPDATE 
  USING ( id = public.get_auth_company_id() AND public.is_company_admin() );


-- ------------------------------------------------------------------------------
-- 4. SEPARAÇÃO DE PERMISSÕES NO RLS: ADMINISTRADOR VS ATENDENTE
-- ------------------------------------------------------------------------------

-- Tabela: agents
DROP POLICY IF EXISTS "Users view own company agents" ON public.agents;
DROP POLICY IF EXISTS "Users manage own company agents" ON public.agents;

CREATE POLICY "Agents: view for company users"
  ON public.agents FOR SELECT
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Agents: manage only for company admins"
  ON public.agents FOR INSERT
  WITH CHECK ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "Agents: update only for company admins"
  ON public.agents FOR UPDATE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "Agents: delete only for company admins"
  ON public.agents FOR DELETE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );


-- Tabela: api_keys (Atendentes NÃO podem visualizar nem gerenciar chaves de webhook)
DROP POLICY IF EXISTS "Users view own company api_keys" ON public.api_keys;
DROP POLICY IF EXISTS "Users manage own company api_keys" ON public.api_keys;

CREATE POLICY "API Keys: view only for company admins"
  ON public.api_keys FOR SELECT
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "API Keys: insert only for company admins"
  ON public.api_keys FOR INSERT
  WITH CHECK ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "API Keys: update only for company admins"
  ON public.api_keys FOR UPDATE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "API Keys: delete only for company admins"
  ON public.api_keys FOR DELETE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );


-- Tabela: integrations (Atendentes NÃO podem visualizar credenciais nem configurar integrações)
DROP POLICY IF EXISTS "Users manage own company integrations" ON public.integrations;

CREATE POLICY "Integrations: view only for company admins"
  ON public.integrations FOR SELECT
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "Integrations: insert only for company admins"
  ON public.integrations FOR INSERT
  WITH CHECK ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "Integrations: update only for company admins"
  ON public.integrations FOR UPDATE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "Integrations: delete only for company admins"
  ON public.integrations FOR DELETE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );


-- Tabela: integration_events e webhook_events
DROP POLICY IF EXISTS "Users view own company integration events" ON public.integration_events;
CREATE POLICY "Integration Events: view only for company admins"
  ON public.integration_events FOR SELECT
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

DROP POLICY IF EXISTS "Users view own webhook events" ON public.webhook_events;
CREATE POLICY "Webhook Events: view only for company admins"
  ON public.webhook_events FOR SELECT
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );


-- Tabela: product_brands
DROP POLICY IF EXISTS "Users view own company product_brands" ON public.product_brands;
DROP POLICY IF EXISTS "Users edit own company product_brands" ON public.product_brands;

CREATE POLICY "Product Brands: view for company users"
  ON public.product_brands FOR SELECT
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Product Brands: insert only for company admins"
  ON public.product_brands FOR INSERT
  WITH CHECK ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "Product Brands: update only for company admins"
  ON public.product_brands FOR UPDATE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "Product Brands: delete only for company admins"
  ON public.product_brands FOR DELETE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );


-- Tabela: product_categories
DROP POLICY IF EXISTS "Users view own company product_categories" ON public.product_categories;
DROP POLICY IF EXISTS "Users edit own company product_categories" ON public.product_categories;

CREATE POLICY "Product Categories: view for company users"
  ON public.product_categories FOR SELECT
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Product Categories: insert only for company admins"
  ON public.product_categories FOR INSERT
  WITH CHECK ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "Product Categories: update only for company admins"
  ON public.product_categories FOR UPDATE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "Product Categories: delete only for company admins"
  ON public.product_categories FOR DELETE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );


-- Tabela: products
DROP POLICY IF EXISTS "Users view own company products" ON public.products;
DROP POLICY IF EXISTS "Users edit own company products" ON public.products;

CREATE POLICY "Products: view for company users"
  ON public.products FOR SELECT
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Products: insert only for company admins"
  ON public.products FOR INSERT
  WITH CHECK ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "Products: update only for company admins"
  ON public.products FOR UPDATE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "Products: delete only for company admins"
  ON public.products FOR DELETE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );


-- Tabela: product_prices
DROP POLICY IF EXISTS "Users view own company product_prices" ON public.product_prices;
DROP POLICY IF EXISTS "Users edit own company product_prices" ON public.product_prices;

CREATE POLICY "Product Prices: view for company users"
  ON public.product_prices FOR SELECT
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Product Prices: insert only for company admins"
  ON public.product_prices FOR INSERT
  WITH CHECK ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "Product Prices: update only for company admins"
  ON public.product_prices FOR UPDATE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "Product Prices: delete only for company admins"
  ON public.product_prices FOR DELETE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );


-- Tabela: product_inventory
DROP POLICY IF EXISTS "Users view own company product_inventory" ON public.product_inventory;
DROP POLICY IF EXISTS "Users edit own company product_inventory" ON public.product_inventory;

CREATE POLICY "Product Inventory: view for company users"
  ON public.product_inventory FOR SELECT
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Product Inventory: manage only for company admins"
  ON public.product_inventory FOR ALL
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );


-- Tabela: workflows
DROP POLICY IF EXISTS "Usuários veem workflows de suas empresas" ON public.workflows;
DROP POLICY IF EXISTS "Usuários inserem workflows em suas empresas" ON public.workflows;
DROP POLICY IF EXISTS "Usuários atualizam workflows de suas empresas" ON public.workflows;
DROP POLICY IF EXISTS "Usuários deletam workflows de suas empresas" ON public.workflows;

CREATE POLICY "Workflows: view for company users"
  ON public.workflows FOR SELECT
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Workflows: insert only for company admins"
  ON public.workflows FOR INSERT
  WITH CHECK ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "Workflows: update only for company admins"
  ON public.workflows FOR UPDATE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "Workflows: delete only for company admins"
  ON public.workflows FOR DELETE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );


-- Tabela: workflow_stages
DROP POLICY IF EXISTS "Usuários veem stages de suas empresas" ON public.workflow_stages;
DROP POLICY IF EXISTS "Usuários inserem stages em suas empresas" ON public.workflow_stages;
DROP POLICY IF EXISTS "Usuários atualizam stages de suas empresas" ON public.workflow_stages;
DROP POLICY IF EXISTS "Usuários deletam stages de suas empresas" ON public.workflow_stages;

CREATE POLICY "Workflow Stages: view for company users"
  ON public.workflow_stages FOR SELECT
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Workflow Stages: insert only for company admins"
  ON public.workflow_stages FOR INSERT
  WITH CHECK ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "Workflow Stages: update only for company admins"
  ON public.workflow_stages FOR UPDATE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

CREATE POLICY "Workflow Stages: delete only for company admins"
  ON public.workflow_stages FOR DELETE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );


-- ------------------------------------------------------------------------------
-- 5. TABELAS OPERACIONAIS DE ATENDIMENTO (CONVERSAS, MENSAGENS, CLIENTES, ORÇAMENTOS)
-- ------------------------------------------------------------------------------

-- Tabela: conversations (Atendentes podem ver, criar e atender; apenas admin pode deletar)
DROP POLICY IF EXISTS "Users can view conversations of their company" ON public.conversations;
DROP POLICY IF EXISTS "Users can insert conversations to their company" ON public.conversations;
DROP POLICY IF EXISTS "Users can update conversations of their company" ON public.conversations;

CREATE POLICY "Conversations: view for company users"
  ON public.conversations FOR SELECT
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Conversations: insert for company users"
  ON public.conversations FOR INSERT
  WITH CHECK ( company_id = public.get_auth_company_id() );

CREATE POLICY "Conversations: update for company users"
  ON public.conversations FOR UPDATE
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Conversations: delete only for company admins"
  ON public.conversations FOR DELETE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );


-- Tabela: messages
DROP POLICY IF EXISTS "Users can view messages of their company" ON public.messages;
DROP POLICY IF EXISTS "Users can insert messages to their company" ON public.messages;
DROP POLICY IF EXISTS "Users can update messages of their company" ON public.messages;

CREATE POLICY "Messages: view for company users"
  ON public.messages FOR SELECT
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Messages: insert for company users"
  ON public.messages FOR INSERT
  WITH CHECK ( company_id = public.get_auth_company_id() );

CREATE POLICY "Messages: update for company users"
  ON public.messages FOR UPDATE
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Messages: delete only for company admins"
  ON public.messages FOR DELETE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );


-- Tabela: customers
DROP POLICY IF EXISTS "Users can view customers of their company" ON public.customers;
DROP POLICY IF EXISTS "Users can insert customers to their company" ON public.customers;
DROP POLICY IF EXISTS "Users can update customers of their company" ON public.customers;

CREATE POLICY "Customers: view for company users"
  ON public.customers FOR SELECT
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Customers: insert for company users"
  ON public.customers FOR INSERT
  WITH CHECK ( company_id = public.get_auth_company_id() );

CREATE POLICY "Customers: update for company users"
  ON public.customers FOR UPDATE
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Customers: delete only for company admins"
  ON public.customers FOR DELETE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );


-- Tabela: quotes
DROP POLICY IF EXISTS "Usuários podem ver orçamentos de suas empresas" ON public.quotes;
DROP POLICY IF EXISTS "Usuários podem inserir orçamentos em suas empresas" ON public.quotes;
DROP POLICY IF EXISTS "Usuários podem atualizar orçamentos de suas empresas" ON public.quotes;

CREATE POLICY "Quotes: view for company users"
  ON public.quotes FOR SELECT
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Quotes: insert for company users"
  ON public.quotes FOR INSERT
  WITH CHECK ( company_id = public.get_auth_company_id() );

CREATE POLICY "Quotes: update for company users"
  ON public.quotes FOR UPDATE
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Quotes: delete only for company admins"
  ON public.quotes FOR DELETE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );


-- Tabela: quote_items (Itens de orçamentos podem ser deletados durante recálculo/edição)
DROP POLICY IF EXISTS "Usuários podem ver itens de orçamentos de suas empresas" ON public.quote_items;
DROP POLICY IF EXISTS "Usuários podem inserir itens de orçamentos em suas empresas" ON public.quote_items;
DROP POLICY IF EXISTS "Usuários podem atualizar itens de orçamentos de suas empresas" ON public.quote_items;

CREATE POLICY "Quote Items: view for company users"
  ON public.quote_items FOR SELECT
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Quote Items: insert for company users"
  ON public.quote_items FOR INSERT
  WITH CHECK ( company_id = public.get_auth_company_id() );

CREATE POLICY "Quote Items: update for company users"
  ON public.quote_items FOR UPDATE
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Quote Items: delete for company users"
  ON public.quote_items FOR DELETE
  USING ( company_id = public.get_auth_company_id() );


-- Tabela: message_outbox
DROP POLICY IF EXISTS "Users view own company outbox" ON public.message_outbox;
DROP POLICY IF EXISTS "Users manage own company outbox" ON public.message_outbox;

CREATE POLICY "Outbox: view for company users"
  ON public.message_outbox FOR SELECT
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Outbox: insert for company users"
  ON public.message_outbox FOR INSERT
  WITH CHECK ( company_id = public.get_auth_company_id() );

CREATE POLICY "Outbox: update for company users"
  ON public.message_outbox FOR UPDATE
  USING ( company_id = public.get_auth_company_id() );

CREATE POLICY "Outbox: delete only for company admins"
  ON public.message_outbox FOR DELETE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );


-- Tabela: agent_runs
DROP POLICY IF EXISTS "Users view own company agent runs" ON public.agent_runs;
CREATE POLICY "Agent Runs: view for company users"
  ON public.agent_runs FOR SELECT
  USING ( company_id = public.get_auth_company_id() );


-- ------------------------------------------------------------------------------
-- 6. INTEGRIDADE ENTRE TENANTS (TRIGGERS DE VALIDAÇÃO DE ESCOPO REFERENCIAL)
-- ------------------------------------------------------------------------------

-- 6.1. Validação de Produtos: marca e categoria associadas devem pertencer à mesma empresa
CREATE OR REPLACE FUNCTION public.check_product_tenant_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.brand_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.product_brands WHERE id = NEW.brand_id AND company_id = NEW.company_id) THEN
      RAISE EXCEPTION 'Violação de integridade multi-tenant: a marca associada (brand_id) não pertence à mesma empresa do produto.';
    END IF;
  END IF;

  IF NEW.category_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.product_categories WHERE id = NEW.category_id AND company_id = NEW.company_id) THEN
      RAISE EXCEPTION 'Violação de integridade multi-tenant: a categoria associada (category_id) não pertence à mesma empresa do produto.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_product_tenant_integrity ON public.products;
CREATE TRIGGER trg_check_product_tenant_integrity
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.check_product_tenant_integrity();


-- 6.2. Validação de Categorias: categoria pai deve pertencer à mesma empresa
CREATE OR REPLACE FUNCTION public.check_category_tenant_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.product_categories WHERE id = NEW.parent_id AND company_id = NEW.company_id) THEN
      RAISE EXCEPTION 'Violação de integridade multi-tenant: a categoria pai (parent_id) não pertence à mesma empresa.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_category_tenant_integrity ON public.product_categories;
CREATE TRIGGER trg_check_category_tenant_integrity
BEFORE INSERT OR UPDATE ON public.product_categories
FOR EACH ROW
EXECUTE FUNCTION public.check_category_tenant_integrity();


-- 6.3. Validação de Preços: produto precificado deve pertencer à mesma empresa
CREATE OR REPLACE FUNCTION public.check_price_tenant_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = NEW.product_id AND company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'Violação de integridade multi-tenant: o produto precificado (product_id) não pertence à mesma empresa da regra de preço.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_price_tenant_integrity ON public.product_prices;
CREATE TRIGGER trg_check_price_tenant_integrity
BEFORE INSERT OR UPDATE ON public.product_prices
FOR EACH ROW
EXECUTE FUNCTION public.check_price_tenant_integrity();


-- 6.4. Validação de Etapas de Workflow: workflow associado deve pertencer à mesma empresa
CREATE OR REPLACE FUNCTION public.check_workflow_stage_tenant_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workflows WHERE id = NEW.workflow_id AND company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'Violação de integridade multi-tenant: o workflow associado (workflow_id) não pertence à mesma empresa da etapa.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_workflow_stage_tenant_integrity ON public.workflow_stages;
CREATE TRIGGER trg_check_workflow_stage_tenant_integrity
BEFORE INSERT OR UPDATE ON public.workflow_stages
FOR EACH ROW
EXECUTE FUNCTION public.check_workflow_stage_tenant_integrity();


-- 6.5. Validação de Itens de Orçamento: orçamento e produto devem pertencer à mesma empresa
CREATE OR REPLACE FUNCTION public.check_quote_item_tenant_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.quotes WHERE id = NEW.quote_id AND company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'Violação de integridade multi-tenant: o orçamento associado (quote_id) não pertence à mesma empresa do item.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = NEW.product_id AND company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'Violação de integridade multi-tenant: o produto do item (product_id) não pertence à mesma empresa.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_quote_item_tenant_integrity ON public.quote_items;
CREATE TRIGGER trg_check_quote_item_tenant_integrity
BEFORE INSERT OR UPDATE ON public.quote_items
FOR EACH ROW
EXECUTE FUNCTION public.check_quote_item_tenant_integrity();
