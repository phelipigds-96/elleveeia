let mockGenerateContentImpl = null

export function setMockGeminiGenerateContent(fn) {
  mockGenerateContentImpl = fn
}

export class GoogleGenAI {
  constructor(_opts) {
    this.models = {
      generateContent: (args) => {
        if (mockGenerateContentImpl) {
          return mockGenerateContentImpl(args)
        }
        return Promise.resolve({
          text: '',
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 1,
            totalTokenCount: 2,
          },
        })
      },
    }
  }
}

export const Type = {
  OBJECT: 'OBJECT',
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
  ARRAY: 'ARRAY',
}
