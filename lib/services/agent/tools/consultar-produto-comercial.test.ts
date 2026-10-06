import { consultarProdutoComercialTool } from './consultar-produto-comercial'
import { searchProducts } from '../../catalog/products'
import { resolveProductPrice } from '../../commercial/pricing'

// Mocks
jest.mock('../../catalog/products')
jest.mock('../../commercial/pricing')

describe('Tool: consultar_produto_comercial', () => {
  const mockContext = {
    companyId: 'test-company-id',
    agentId: 'agent-1',
    conversationId: 'conv-1'
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('deve retornar exact_match e o preo se a busca for bem-sucedida', async () => {
    ;(searchProducts as jest.Mock).mockResolvedValue({
      status: 'exact_match',
      confidence: 0.98,
      matches: [{
        id: 'prod-1',
        name: 'Cobertura Genuine Meio Amargo 1kg',
        brand: 'Genuine',
        unit: 'kg'
      }]
    })

    ;(resolveProductPrice as jest.Mock).mockResolvedValue({
      productId: 'prod-1',
      quantity: 1,
      unitPrice: 29.99,
      subtotal: 29.99,
      priceType: 'retail',
      minQuantity: 1,
      source: 'product_prices'
    })

    const result = await consultarProdutoComercialTool.execute({
      product_query: 'cobertura genuine meio amargo 1kg'
    }, mockContext)

    expect(result.success).toBe(true)
    expect(result.data.status).toBe('exact_match')
    expect(result.data.product.id).toBe('prod-1')
    expect(result.data.pricing.unit_price).toBe(29.99)
  })

  it('deve retornar ambiguous e os candidatos se a busca for ambgua', async () => {
    ;(searchProducts as jest.Mock).mockResolvedValue({
      status: 'ambiguous',
      confidence: 0.8,
      matches: [
        { id: 'prod-1', name: 'Cobertura Genuine 1kg', brand: 'Genuine', unit: 'kg' },
        { id: 'prod-2', name: 'Cobertura Genuine 500g', brand: 'Genuine', unit: 'g' }
      ]
    })

    const result = await consultarProdutoComercialTool.execute({
      product_query: 'cobertura genuine'
    }, mockContext)

    expect(result.success).toBe(true)
    expect(result.data.status).toBe('ambiguous')
    expect(result.data.matches).toHaveLength(2)
    // No should not have called price
    expect(resolveProductPrice).not.toHaveBeenCalled()
  })

  it('deve retornar not_found se a busca nǜo retornar resultados', async () => {
    ;(searchProducts as jest.Mock).mockResolvedValue({
      status: 'not_found',
      confidence: 0,
      matches: []
    })

    const result = await consultarProdutoComercialTool.execute({
      product_query: 'produto inexistente'
    }, mockContext)

    expect(result.success).toBe(true)
    expect(result.data.status).toBe('not_found')
    expect(resolveProductPrice).not.toHaveBeenCalled()
  })
})
