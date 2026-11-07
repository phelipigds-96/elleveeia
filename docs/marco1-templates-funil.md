# Marco 1 — Personalização de funis Kanban por empresa (backend)

## Objetivo
Evoluir o modelo de dados de `workflow_stages` e criar o motor de **Templates por
Segmento** no backend, sem alterar o enum `stage_type` e sem quebrar a suíte
`etapa8.4.3p*`.

## 1. Modelo de dados

Arquivo: `supabase/migrations/2026110701_workflow_stages_handled_by_and_color.sql`

Novas colunas em `public.workflow_stages`:

| Coluna | Tipo | Default | Papel |
|---|---|---|---|
| `color` | `TEXT` | `'#64748b'` | Cor hexadecimal do cabeçalho da coluna no Kanban (apresentação) |
| `handled_by` | `TEXT` | `'human'` | Responsável operacional: `ai` \| `human` \| `waiting` |

Constraint de domínio: `ck_workflow_stages_handled_by` — `CHECK (handled_by IS NULL OR handled_by IN ('ai','human','waiting'))`.

Backfill (executado na migração, idempotente):
- `stage_type = 'initial'` → `handled_by = 'ai'`
- `stage_type = 'in_progress'` → `handled_by = 'human'`
- `stage_type = 'final'` → `handled_by = 'human'`
- Linhas já marcadas como `'waiting'` são preservadas.

Estado verificado no banco após a migração: 3 etapas, 0 sem cor, 0 sem responsável,
constraint ativa com o domínio esperado.

### Compatibilidade
`stage_type` ('initial' | 'in_progress' | 'final') permanece intocado e continua sendo
a **única** fonte de verdade para a sincronização funil ↔ lista de conversas
(`moveConversationStage` decide `status`/`assigned_to` a partir do `stage_type`).
`color` e `handled_by` são atributos descritivos e não alteram esse contrato.

## 2. Serviço de workflows (`lib/services/workflows/workflows.ts`)

- `WorkflowStage` ganhou `color?: string | null` e `handled_by?: 'ai' | 'human' | 'waiting'`.
- `createWorkflowStage` persiste `color` e `handled_by` (sanitizados: hex de 3 ou 6 dígitos, valor do domínio).
- `updateWorkflowStage` aceita `color`/`handled_by` em `updates`, com validação e limpeza.
- `getOrCreateDefaultWorkflow` cria as etapas padrão já com `color` e `handled_by`, e é idempotente.

## 3. Biblioteca de templates (`lib/services/workflows/templates.ts`)

Catálogo tipado por vertical:

| Chave | Vertical | Etapas |
|---|---|---|
| `retail_food` | Varejo & Confeitaria (Sumel) | Novo Contato / Cardápio · Orçamento em Aberto · Aguardando Pagamento (Pix) · Em Separação / Cozinha · Saiu para Entrega / Retirada · Pedido Concluído |
| `events_party` | Salão de Festas & Eventos | Primeiro Contato · Data Disponível · Visita / Degustação Agendada · Proposta Enviada · Contrato Fechado · Data Indisponível / Perdido |
| `dental_clinic` | Clínica Odontológica | Triagem & Dúvidas · Agendamento em Andamento · Consulta Agendada · Lembrete / Confirmação 24h · Tratamento Concluído |
| `general_services` | Serviços & B2B Geral | Entrada / Qualificação · Em Negociação · Aguardando Cliente · Finalizado / Ganho · Arquivado / Perdido |

Função principal:

```ts
applyWorkflowTemplate({ companyId?, workflowId?, templateKey })
```

Garantias:
1. O tenant é resolvido **no servidor**, pela sessão; o `companyId` recebido é apenas conferido contra o perfil autenticado.
2. `requireActiveCompany` bloqueia empresas inativas.
3. Apenas `owner`/`admin`/`superadmin` da própria empresa podem reconfigurar o funil.
4. O `workflowId` informado precisa pertencer à empresa; caso contrário, usa o workflow padrão (`getOrCreateDefaultWorkflow`).
5. Etapas com o mesmo nome são **atualizadas** (posição, `stage_type`, `color`, `handled_by`) preservando o `id` — conversas vinculadas não ficam órfãs.
6. Etapas fora do template são **desativadas** (`is_active = false`), sem exclusão física.
7. Conversas em etapas desativadas são realocadas para a etapa inicial do template; conversas sem etapa também recebem a etapa inicial.

## 4. Server Actions (`app/(dashboard)/settings/workflows/template-actions.ts`)

- `listWorkflowTemplatesAction()` — catálogo para a UI.
- `applyWorkflowTemplateAction({ templateKey, workflowId? })` — valida com Zod, aplica no servidor e revalida `/settings/workflows`, `/conversations` e `/conversations/kanban`.

## 5. Testes

`lib/services/agent/tools/etapa8.4.3p5-workflow-templates.test.ts` cobre as funções puras:
integridade do catálogo, domínio de `stage_type` e `handled_by`, formato das cores, unicidade de nomes, uma única etapa inicial por template, comportamento de `getWorkflowTemplate` e coerência das etapas padrão do funil.

O caminho de escrita (`applyWorkflowTemplate`) é coberto por integração, pois exige sessão, tenant ativo e escrita em `workflow_stages`/`conversations`.

## Pendências do próximo marco
- UI de seleção de template na tela `/settings/workflows`.
- Kanban lendo `color`/`handled_by` para pintar colunas e filtrar por responsável.
- Regras de transição e automações por etapa (hoje apenas descritas por `handled_by`).
