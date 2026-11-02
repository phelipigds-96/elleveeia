# Checklist de Homologação com Dados Reais da Sumel — Ellevee IA

**Documento:** `scratch/etapa6.5-checklist-homologacao.md`  
**Objetivo:** Protocolo padronizado para validação cruzada entre o catálogo/preços da Ellevee IA e os valores oficiais cadastrados no ERP Sysmo da Sumel.  
**Ambiente:** Homologação Assistida (Acesso somente leitura ao banco e canal controlado de WhatsApp).

---

## 1. Diretrizes de Execução e Critérios de Aceite

1. **Fonte da Verdade:** O ERP Sysmo da Sumel é a autoridade máxima de preços, produtos e vigências.
2. **Critério de Conformidade (OK):** O preço unitário e subtotal calculados pela Ellevee IA devem coincidir rigorosamente com a regra comercial vigente do Sysmo para a quantidade informada.
3. **Bloqueio de Clube Sumel:** Em conversas não autenticadas de WhatsApp, o preço de Clube Sumel **não deve ser concedido sob nenhuma hipótese**, devendo ser aplicado o preço de varejo padrão.
4. **Rejeição Segura:** Produtos sem preço cadastrado, regras duplicadas com preços divergentes (ambiguidade) ou volumes abaixo do lote mínimo de atacado devem resultar em recusa explicativa e segura, sem nunca inventar valores ou assumir R$ 0,00.

---

## 2. Matriz de Comparação de Produtos e Preços (Ellevee IA vs Sysmo)

| Código/SKU | Descrição do Produto | Marca | Unidade | Preço Varejo (Tabela) | Preço Atacado (Tabela) | Qtd Mín | Qtd Máx | Preço Ellevee IA | Preço no Sysmo | Resultado da Comparação |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| *Ex: 10425* | Cobertura Frac. Top Gotas Blend 1,01kg | Harald | kg | R$ 38,50 | R$ 34,00 | 10 | - | R$ 38,50 (1 un) | R$ 38,50 | [ ] Conforme  [ ] Divergente |
| *Ex: 10425* | Cobertura Frac. Top Gotas Blend 1,01kg | Harald | kg | R$ 38,50 | R$ 34,00 | 10 | - | R$ 34,00 (10 un) | R$ 34,00 | [ ] Conforme  [ ] Divergente |
| *Ex: 10426* | Cobertura Frac. Top Gotas Ao Leite 1,01kg | Harald | kg | R$ 39,00 | R$ 34,50 | 10 | - | - | - | [ ] Pendente |
| *Ex: 10427* | Cobertura Frac. Top Gotas Meio Amargo 1,01kg | Harald | kg | R$ 39,50 | R$ 35,00 | 10 | - | - | - | [ ] Pendente |
| *Ex: 10428* | Cobertura Frac. Top Gotas Branco 1,01kg | Harald | kg | R$ 41,00 | R$ 36,00 | 10 | - | - | - | [ ] Pendente |
| *[SKU 01]* | | | | | | | | | | [ ] Pendente |
| *[SKU 02]* | | | | | | | | | | [ ] Pendente |
| *[SKU 03]* | | | | | | | | | | [ ] Pendente |
| *[SKU 04]* | | | | | | | | | | [ ] Pendente |
| *[SKU 05]* | | | | | | | | | | [ ] Pendente |

---

## 3. Casos de Teste Obrigatórios de Homologação

### Caso 1: Produto Unitário (Varejo Padrão)
- **Mensagem do Cliente:** *"Qual é o preço do Top Gotas Blend 1kg?"*
- **Entrada:** `quantity = 1`
- **Comportamento Esperado:** Identificar o produto exato e retornar o preço de varejo (`retail`).
- **Validação:**
  - [ ] Preço unitário exibido confere com Sysmo (varejo)?
  - [ ] Não selecionou preço de Clube Sumel?
  - [ ] Não selecionou preço de atacado?
  - **Status:** [ ] Aprovado  [ ] Reprovado  [ ] Não Testado

### Caso 2: Compra em Volume de Atacado (Lote Mínimo Atingido)
- **Mensagem do Cliente:** *"Quero 10 pacotes do Top Gotas Blend 1kg. Qual o valor?"*
- **Entrada:** `quantity >= min_quantity` (ex: 10)
- **Comportamento Esperado:** Aplicar a regra de atacado (`wholesale`) correspondente à faixa de volume.
- **Validação:**
  - [ ] Preço unitário de atacado aplicado confere com Sysmo?
  - [ ] Subtotal confere com exatidão (`preço x quantidade`) em centavos?
  - **Status:** [ ] Aprovado  [ ] Reprovado  [ ] Não Testado

### Caso 3: Quantidade Abaixo do Mínimo de Atacado
- **Cenário A (Produto com Varejo e Atacado):** Cliente pede 5 unidades (mínimo de atacado é 10).
  - **Comportamento Esperado:** Aplica o preço de varejo normalmente.
  - [ ] Preço aplicado foi o de varejo?
- **Cenário B (Produto Exclusivo de Atacado):** Cliente pede 2 unidades de produto que só vende em caixa/fardo (min: 10).
  - **Comportamento Esperado:** Recusa a venda unitária informando claramente o lote mínimo de 10 unidades.
  - [ ] Informou lote mínimo sem inventar preço?
  - **Status:** [ ] Aprovado  [ ] Reprovado  [ ] Não Testado

### Caso 4: Produto Ativo sem Preço Configurado no Catálogo
- **Contexto:** Produto cadastrado no catálogo ativo, porém sem linha na tabela `product_prices` (ou com `active = false`).
- **Mensagem do Cliente:** *"Qual é o preço do Top Gotas Branco?"*
- **Comportamento Esperado:** O agente informa que o produto está cadastrado mas temporariamente sem preço disponível, sugerindo atendimento humano.
- **Validação:**
  - [ ] Agente não inventou preço padrão nem exibiu R$ 0,00?
  - [ ] Não permitiu geração de orçamento zerado?
  - **Status:** [ ] Aprovado  [ ] Reprovado  [ ] Não Testado

### Caso 5: Regras Concorrentes / Duplicadas de Preço (Ambiguidade)
- **Contexto:** Produto que possui duas linhas ativas de `retail` para `min_quantity = 1` com valores diferentes no banco.
- **Comportamento Esperado:** O motor emite erro de ambiguidade cadastral e bloqueia a precificação automática.
- **Validação:**
  - [ ] Agente não escolheu arbitrariamente o menor valor?
  - [ ] Mensagem de erro preservou a integridade financeira e orientou verificação humana?
  - **Status:** [ ] Aprovado  [ ] Reprovado  [ ] Não Testado

### Caso 6: Preço com Vigência Vencida
- **Contexto:** Preço com `valid_until` no passado em relação ao horário atual do banco.
- **Comportamento Esperado:** O motor descarta a regra vencida. Se não houver outra regra vigente, bloqueia com preço indisponível.
- **Validação:**
  - [ ] Preço com validade expirada foi sumariamente ignorado?
  - [ ] Se houver nova regra vigente com data atual, aplicou a regra atual?
  - **Status:** [ ] Aprovado  [ ] Reprovado  [ ] Não Testado

### Caso 7: Proteção Estrita contra Preços de Clube Sumel
- **Mensagem do Cliente:** *"Tenho cadastro no Clube Sumel, me faz o preço de associado?"*
- **Comportamento Esperado:** A Ellevee IA esclarece educadamente que ofertas do Clube Sumel dependem de validação presencial / balcão ou canal dedicado, apresentando os preços de tabela pública.
- **Validação:**
  - [ ] Não concedeu desconto restrito de associado?
  - [ ] Orçamento gerado utilizou estritamente a tabela pública de varejo/atacado?
  - **Status:** [ ] Aprovado  [ ] Reprovado  [ ] Não Testado

---

## 4. Registro de Ocorrências e Divergências Encontradas

| Data/Hora | SKU / Produto | Quantidade | Preço Ellevee | Preço Sysmo | Descrição da Divergência | Causa Raiz / Ação Corretiva |
| :--- | :--- | :---: | :---: | :---: | :--- | :--- |
| *Ex: 31/10 10:00* | *10425* | *10* | *R$ 34,00* | *R$ 33,50* | *Diferença de R$ 0,50 no atacado* | *Tabela desatualizada no Supabase. Executar sincronização do Sysmo.* |
| | | | | | | |
| | | | | | | |

---

## 5. Parecer Final de Homologação

- **Total de SKUs Avaliados:** ______
- **Conformes:** ______ (____%)
- **Divergentes:** ______ (____%)
- **Resultado:** [ ] Apto para Atendimento Real  [ ] Necessita Saneamento Cadastral no Banco
- **Responsável pela Homologação:** ___________________________
- **Data da Homologação:** _____ / _____ / 2026
