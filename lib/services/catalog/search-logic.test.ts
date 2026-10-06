import { tokenizeQuery, calculateMatchScore } from './search-logic'

// Este arquivo contǸm testes unitǭrios para a lgica de busca inteligente do catǭlogo

describe('Catalog Search Logic', () => {

  describe('Tokenization', () => {
    it('should tokenize and recognize multi-word specifics', () => {
      const tokens = tokenizeQuery('cobertura genuine meio amargo 1kg')
      
      const generic = tokens.find(t => t.original === 'cobertura')
      expect(generic?.isGeneric).toBe(true)

      const specific = tokens.find(t => t.original === 'genuine')
      expect(specific?.isGeneric).toBe(false)
      
      const multi = tokens.find(t => t.original === 'meio amargo')
      expect(multi?.variants).toContain('m amargo')
      expect(multi?.isGeneric).toBe(false)

      const unit = tokens.find(t => t.original === '1kg')
      expect(unit?.isUnit).toBe(true)
    })

    it('should handle decimal weights', () => {
      const tokens = tokenizeQuery('sicao 1.01kg')
      const unit = tokens.find(t => t.isUnit)
      expect(unit?.original).toBe('1.01kg')
      expect(unit?.variants).toContain('1 01kg')
    })
  })

  describe('Scoring', () => {
    it('Teste 1 & 2: Natural description vs DB format', () => {
      // Catǭlogo: Cob. genuine m/amargo 1kg
      // normalized_name: cob genuine m amargo 1kg
      const dbName = 'cob genuine m amargo 1kg'
      const tokens = tokenizeQuery('cobertura genuine meio amargo de 1kg')
      
      const score = calculateMatchScore(dbName, tokens)
      expect(score).toBeGreaterThan(50) // High score for matching specific + unit + generic
    })

    it('Teste 3: Abbreviations in query', () => {
      const dbName = 'cobertura genuine meio amargo 1kg'
      const tokens = tokenizeQuery('cob genuine m/amargo 1kg')
      const score = calculateMatchScore(dbName, tokens)
      expect(score).toBeGreaterThan(50)
    })

    it('Teste 4: False positive penalty', () => {
      const dbNameWhite = 'cob genuine branco 1kg'
      const dbNameDark = 'cob genuine m amargo 1kg'
      
      // Query looking for white
      const tokens = tokenizeQuery('Cobertura Genuine Branco 1kg')
      
      const scoreWhite = calculateMatchScore(dbNameWhite, tokens)
      const scoreDark = calculateMatchScore(dbNameDark, tokens)
      
      // Branco must score significantly higher than meio amargo
      expect(scoreWhite).toBeGreaterThan(scoreDark + 15)
    })

    it('Teste 5: Chocolate vs Sicao', () => {
      const dbName = 'choc sicao m amargo 1kg'
      const tokens = tokenizeQuery('Chocolate Sicao Meio Amargo 1kg')
      const score = calculateMatchScore(dbName, tokens)
      expect(score).toBeGreaterThan(50)
    })
  })
})
