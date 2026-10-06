import { parseQuery, calculateMatchScore } from './search-logic'

describe('Catalog Search Logic v2', () => {

  describe('Tokenization and Parsing', () => {
    it('should parse multi-word tokens and distinguish attributes', () => {
      const parsed = parseQuery('quanto ta a cobertura genuine meio amargo de 1kg')
      
      expect(parsed.significantTokens).toContain('genuine')
      expect(parsed.genericTokens).toContain('cobertura')
      expect(parsed.weight).toBe(1)
      expect(parsed.unit).toBe('kg')
      
      const mw = parsed.tokenGroups.find(t => t.original === 'meio amargo')
      expect(mw?.variants).toContain('m amargo')
    })
  })

  describe('Scoring and Confidence', () => {
    it('Teste A & B: exact_match score', () => {
      const dbName = 'cob genuine m amargo 1kg'
      const parsed = parseQuery('quanto ta a cobertura genuine meio amargo de 1kg')
      
      const { score, confidence, penalty } = calculateMatchScore(dbName, 'genuine', 'cobertura', parsed)
      
      expect(penalty).toBe(0) // No missing tokens
      expect(confidence).toBe(1.0)
      expect(score).toBeGreaterThan(60)
    })

    it('Teste D & F: Ambiguity and missing unit', () => {
      const parsed = parseQuery('quanto custa a cobertura genuine meio amargo') // No unit
      
      const { score: score1kg, penalty: pen1 } = calculateMatchScore('cob genuine m amargo 1kg', 'genuine', 'cobertura', parsed)
      const { score: score500g, penalty: pen2 } = calculateMatchScore('cob genuine m amargo 500g', 'genuine', 'cobertura', parsed)
      
      // Both match the query equally well, since the query has no unit
      expect(score1kg).toBe(score500g)
      expect(pen1).toBe(0)
      expect(pen2).toBe(0)
    })

    it('Teste E: False positive penalty', () => {
      // Query looking for white
      const parsed = parseQuery('quanto custa a cobertura genuine branca 1kg')
      
      const resWhite = calculateMatchScore('cob genuine branco 1kg', 'genuine', 'cobertura', parsed)
      const resDark = calculateMatchScore('cob genuine m amargo 1kg', 'genuine', 'cobertura', parsed)
      
      // Branco must score significantly higher, Dark must be penalized for missing "branca/branco"
      expect(resWhite.score).toBeGreaterThan(resDark.score + 20)
      expect(resDark.penalty).toBeGreaterThan(0)
      expect(resDark.confidence).toBeLessThan(1.0)
    })
  })
})
