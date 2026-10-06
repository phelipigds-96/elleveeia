import fs from 'fs';
import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';

// Vamos importar os schemas diretamente replicando a lgica do ToolRegistry
const tools = [
  {
    name: 'consultar_produto_comercial',
    description: 'Busca um produto no catálogo e já calcula o preço correto em uma única etapa. Utilize esta ferramenta preferencialmente quando o usuário perguntar sobre produtos E preços (ex: "quanto custa a cobertura x"). Não assuma estoque se o status for "not_found", diga apenas que o produto não foi localizado. Se for "ambiguous", peça para o usuário esclarecer.',
    schema: z.object({
      product_query: z.string().describe('Frase ou termos de busca informados pelo cliente (ex: "cobertura genuine meio amargo 1kg").'),
      quantity: z.number().int().positive().optional().describe('Quantidade desejada. Se não informada, assume 1.'),
      price_type: z.string().optional().describe('Tipo de preço desejado, ex: retail, wholesale, club. Deixe vazio para aplicar a melhor regra automática.')
    })
  },
  {
    name: 'buscar_produto',
    description: 'Busca produtos do catálogo da empresa por nome ou características. ATENÇÃO: NÃO existe integração de estoque no momento. Se o status for "not_found", responda apenas que o produto não foi localizado no catálogo, e NUNCA afirme que está "sem estoque". Se for "ambiguous", peça para o usuário esclarecer (ex: escolhendo entre os tamanhos/sabores retornados).',
    schema: z.object({
      query: z.string().describe('Frase ou termos de busca informados pelo cliente (ex: "cobertura genuine meio amargo 1kg").'),
      limit: z.number().optional().describe('Quantidade máxima de resultados a retornar (padrão 5).')
    })
  },
  {
    name: 'calcular_preco_produto',
    description: 'Calcula o preço de um produto de acordo com a quantidade solicitada, retornando o preço unitário aplicável, subtotal e regras respeitadas.',
    schema: z.object({
      product_id: z.string().uuid().describe('ID único do produto retornado pela buscar_produto'),
      quantity: z.number().int().positive().describe('Quantidade desejada do produto (maior que zero)'),
      price_type: z.string().optional().describe('Tipo de preço desejado, ex: retail, wholesale, club. Deixe vazio para aplicar a melhor regra.')
    })
  },
  {
    name: 'gerar_orcamento',
    description: 'Gera ou atualiza um orcamento/pedido no sistema com base no produto em foco na memoria de contexto e nas quantidades solicitadas.',
    schema: z.object({
      items: z.array(z.object({
        product_id: z.string(),
        quantity: z.number(),
        unit_price: z.number().optional()
      })).describe('Itens do orçamento. Tente puxar ids e preços da Working Memory se disponíveis.'),
      customer_notes: z.string().optional()
    })
  },
  {
    name: 'get_current_datetime',
    description: 'Retorna a data e hora atual do sistema. Use isso quando o usuário perguntar o horário de agora, que dia é hoje, se a loja está aberta agora, etc.',
    schema: z.object({})
  }
];

function getPayloadForTools(toolNames) {
  const selectedTools = tools.filter(t => toolNames.includes(t.name));
  return selectedTools.map(tool => {
    const jsonSchema = zodToJsonSchema(tool.schema, 'mySchema');
    const properties = jsonSchema.definitions?.mySchema?.properties || jsonSchema.properties || {};
    const required = jsonSchema.definitions?.mySchema?.required || jsonSchema.required || [];

    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties,
        required
      }
    };
  });
}

function estimateTokens(text) {
  // Rough estimate for PT-BR text: 1 token = ~4 chars
  return Math.ceil(text.length / 4);
}

function sizeOf(obj) {
  const str = JSON.stringify(obj);
  return {
    chars: str.length,
    tokens: estimateTokens(str)
  };
}

console.log("=== TOOL SCHEMA SIZES ===");
tools.forEach(t => {
  const s = sizeOf(getPayloadForTools([t.name])[0]);
  console.log(`Tool: ${t.name} -> ${s.chars} chars, ~${s.tokens} tokens`);
});

const scenarios = [
  { name: 'Saudação (0 tools)', tools: [] },
  { name: 'Data/Hora (1 tool)', tools: ['get_current_datetime'] },
  { name: 'Busca (buscar_produto)', tools: ['buscar_produto'] },
  { name: 'Produto + Preço (comercial)', tools: ['consultar_produto_comercial'] },
  { name: 'Orçamento (gerar_orcamento)', tools: ['gerar_orcamento', 'consultar_produto_comercial'] }
];

console.log("\n=== SCOPING SIZES ===");
scenarios.forEach(sc => {
  const payload = getPayloadForTools(sc.tools);
  const s = sizeOf(payload);
  console.log(`Scenario: ${sc.name} -> ~${s.tokens} tokens`);
});
