# Ellevee IA

Ellevee IA é uma plataforma SaaS para operação e gerenciamento de agentes de Inteligência Artificial para atendimento ao cliente.

Este repositório contém a versão MVP e estrutural do projeto, preparado para um ambiente Multi-Tenant.

## Stack Tecnológica

- Next.js (App Router, TypeScript)
- Tailwind CSS + shadcn/ui
- Supabase (PostgreSQL, Authentication, RLS)
- Vercel (Hospedagem)

## Como Iniciar

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Configure as variáveis de ambiente:
   - Copie o arquivo `.env.example` para `.env.local`
   - Preencha com a URL do seu projeto Supabase e a `anon_key`
   - `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`

3. Configure o Banco de Dados (Supabase):
   - Vá no seu painel do Supabase.
   - Execute o script localizado em `docs/schema.sql` no SQL Editor do Supabase.

4. Rode o ambiente de desenvolvimento:
   ```bash
   npm run dev
   ```
   Acesse [http://localhost:3000](http://localhost:3000)

## Deploy na Vercel

O projeto foi construído nativamente para a Vercel. 
1. Conecte seu repositório GitHub na Vercel.
2. Nas configurações de deploy, preencha as "Environment Variables" com as credenciais do Supabase.
3. Faça o deploy.

## Arquitetura e Próximos Módulos

Consulte a pasta `docs/architecture.md` para entender a organização do código e os planos futuros (Integração IA, WhatsApp, n8n).
