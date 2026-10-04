# Arquitetura - Ellevee IA

A arquitetura foi projetada para ser escalável, modular e cloud-native (Vercel + Supabase), com suporte a multi-tenancy e multi-segmento desde sua raiz.

## Princípios Core
1. **Frontend + API Unificados:** Utilização de Next.js (App Router) tanto para interfaces quanto para endpoints (Server Actions / Route Handlers).
2. **Multi-Tenant SaaS:** O modelo de dados baseia-se em `companies` (Tenants) e `profiles` (Usuários). **Toda operação** cruza com o `company_id` validado sever-side, nunca confiando em inputs do navegador.
3. **Isolamento de Segurança:** RLS (Row Level Security) aplicado rigidamente a todas as tabelas garantindo total blindagem entre as empresas.
4. **Agent Engine Genérico (Multi-segmento):** O núcleo da inteligência não usa condições estáticas. A lógica de negócio é impulsionada através de `Tools` dinâmicas injetadas via configuração do Agente.

## Hierarquia do Agent Engine (Fase 7+)
A plataforma comporta o modelo:
`Company -> Agents -> Tools`

Uma empresa poderá ter um ou múltiplos agentes no futuro. Cada agente possui seu próprio `segment` (meramente informativo/template), `personality`, `instructions` (prompt base) e um pacote de capacidades habilitadas (Tools).

Isso previne que a plataforma se torne um monólito acoplado a uma única regra de negócio. Um agente de Consultório terá a Tool de `Agendamento`, enquanto o agente de Loja possuirá a Tool de `Estoque`. As `Conversations` vinculam-se a esse `agent_id` garantindo rastreabilidade perfeita.

## Business Data Architecture

A arquitetura de dados do negócio opera sob o seguinte padrão estrito:

```text
Company
 ↓
Business Data (Products, Prices, Inventory, etc.)
 ↓
Tools (Validadas e isoladas por companyId)
 ↓
Agent Engine
 ↓
LLM Provider
```

- **Isolamento de Tenant**: Os dados de negócios (`products`, `product_prices`, etc.) pertencem rigidamente a uma `company`. Um Agent Engine jamais trafega um catálogo inteiro no prompt, e as `Tools` injetam o `companyId` no nível do servidor (via `ToolExecutionContext`).
- **Independência de Segmento**: O Agent Engine **não conhece regras específicas** de nenhum varejo (ex: Sumel). Ele simplesmente aciona a `buscar_produto` se o LLM desejar e responde de volta, permitindo que a mesma infraestrutura atenda Clínicas, Oficinas ou Restaurantes.

## Catalog Import Pipeline

O Ellevee permite a ingestão assíncrona/batch de produtos, de maneira idempotente e amarrada a tenants.

```text
CSV
 ↓
Parser (Server Action manual via Node buffer)
 ↓
Validation (Ignora linhas vazias ou de rodapé)
 ↓
Normalization (Usa função agnóstica de texto)
 ↓
Preview (UI exibe amostra)
 ↓
Confirmation
 ↓
Import Service (Supabase UPSERT constraint)
 ↓
Products / Brands / Categories / Prices
```
- **Identificadores**: Para garantir a idempotência e atualizações parciais de catálogos grandes, utilizamos a restrição `UNIQUE (company_id, sku)`. Na importação via CSV, o `código` atua como SKU confiável da loja.
- **Tratamento de Preços**: A coluna de vendas do CSV é persistida dinamicamente na sub-tabela `product_prices` sob o tipo `retail`, suportando a expansão futura para atacados e promoções de quantidade sem alterar a modelagem principal.
- **Código de Barras**: Mapeado sempre em formato String para blindar perdas de Zeros-à-Esquerda ou notações científicas (`E+12`) provindas de exportações corrompidas de planilhas de terceiros.

## Tool Engine (Function Calling)
A arquitetura do Ellevee IA suporta **Function Calling genérico** e agnóstico a provedor (OpenAI / Gemini).
As ferramentas são registradas e executadas seguindo o fluxo:

```text
Agent Engine
     ↓
LLM Provider (OpenAI/Gemini)
     ↓
Tool Call (InternalToolCall)
     ↓
Tool Registry (Busca definição e Schema Zod)
     ↓
Tool Executor (Valida inputs, executa com Contexto Seguro)
     ↓
Tool (ex: get_current_datetime)
     ↓
Tool Result (InternalToolResult)
     ↓
Agent Engine Loop (Até 5 iterações)
     ↓
LLM Provider
     ↓
Resposta Final (Persistida e devolvida)
```

**Segurança:** O Agent Engine passa um `ToolExecutionContext` com `companyId`, `agentId` e `conversationId` validados do backend. O LLM não tem acesso para falsificar o tenant, e todas as entradas de função são obrigatoriamente validadas via **Zod**.

## LLM Provider Abstraction
O Ellevee IA suporta nativamente **Múltiplos Provedores de IA**, estruturados em `lib/services/llm/`:

```text
Agent Engine
      ↓
LLM Provider Abstraction (factory.ts)
      ├── OpenAIProvider (openai.ts)
      └── GeminiProvider (gemini.ts)
```

O `Agent Engine` não conhece lógicas específicas, SDKs ou endpoints de nenhum fornecedor. Ele apenas chama `provider.generateResponse()`. 
As chaves `OPENAI_API_KEY` e `GEMINI_API_KEY` permanecem restritas ao servidor (nunca enviadas ao frontend).
Os provedores são 100% intercambiáveis, permitindo testar e expandir para novos modelos facilmente.

## Separação entre Integração e Core
- **Orquestrador Externo:** O n8n é utilizado EXCLUSIVAMENTE como camada adaptadora (ex: ler webhook da Meta, traduzir JSON e postar para o Ellevee).
- **Core de Negócio:** O cérebro do produto permanece 100% no Ellevee (Customer Upsert, Conversation Status, Agent Prompting, Execução de Ferramentas).

## Stack Tecnológica
- Next.js (React, TypeScript, App Router)
- Tailwind CSS & shadcn/ui
- Supabase (PostgreSQL, Auth)
- @google/genai (Gemini SDK)