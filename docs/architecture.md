# Arquitetura - Ellevee IA

A arquitetura foi projetada para ser escalável, modular e cloud-native (Vercel + Supabase), com suporte a multi-tenancy desde o dia 1.

## Princípios Core
1. **Frontend + API Unificados:** Utilização de Next.js (App Router) tanto para interfaces quanto para endpoints da API.
2. **Serverless & Edge:** Deploy feito diretamente na Vercel, eliminando necessidades de VPS, Docker ou backend separado inicialmente.
3. **Multi-Tenant SaaS:** O modelo de dados baseia-se em `companies` (Tenants) e `profiles` (Usuários). Qualquer nova entidade (Ex: Mensagens, Configurações de IA) deverá sempre referenciar o `company_id`.
4. **Segurança:** Autenticação via Supabase Auth e RLS (Row Level Security) configurado no banco de dados para garantir que dados de empresas não se misturem.

## Stack
- Next.js 14+ (React, TypeScript, App Router)
- Tailwind CSS & shadcn/ui
- Supabase (PostgreSQL, Auth)
- Lucide Icons

## Estrutura de Diretórios
- `/app/(auth)`: Rotas públicas e de login.
- `/app/(dashboard)`: Rotas privadas da aplicação SaaS. Compartilham o Layout com Sidebar e Header.
- `/components`: Componentes visuais isolados (`/ui`, `/layout`, `/dashboard`).
- `/lib`: Utilitários gerais (`utils.ts`) e configuração do Supabase (`client.ts`, `server.ts`, `middleware.ts`).
- `/docs`: Documentação técnica e esquemas de banco de dados (`schema.sql`).

## Próximos Módulos Planejados (Futuro)
- Integração webhook n8n para orquestração.
- Integração API do WhatsApp (WhatsApp Business API).
- Comunicação direta com a OpenAI para o agente gerativo.
- Ferramentas (Functions) dinâmicas atreladas aos agentes.
