import { describe, expect, it } from 'vitest'
import { getMomenConfig } from '../../src/config/momen'

const validEnvironment = {
  VITE_MOMEN_GRAPHQL_URL:
    'https://villa.momen.app/zero/z7Bx4APAzxO/api/graphql-v2',
  VITE_MOMEN_SUBSCRIPTION_URL:
    'wss://villa.momen.app/zero/z7Bx4APAzxO/api/graphql-subscription',
}

describe('Momen endpoint configuration', () => {
  it('parses the public GraphQL and subscription endpoints', () => {
    const config = getMomenConfig(validEnvironment)

    expect(config.graphqlUrl).toBe(validEnvironment.VITE_MOMEN_GRAPHQL_URL)
    expect(config.subscriptionUrl).toBe(
      validEnvironment.VITE_MOMEN_SUBSCRIPTION_URL,
    )
    expect(Object.isFrozen(config)).toBe(true)
  })

  it('reports a missing endpoint explicitly', () => {
    expect(() =>
      getMomenConfig({
        VITE_MOMEN_SUBSCRIPTION_URL:
          validEnvironment.VITE_MOMEN_SUBSCRIPTION_URL,
      }),
    ).toThrow('Missing required environment variable VITE_MOMEN_GRAPHQL_URL.')
  })

  it('rejects insecure or credential-bearing endpoint URLs', () => {
    expect(() =>
      getMomenConfig({
        ...validEnvironment,
        VITE_MOMEN_GRAPHQL_URL: 'http://villa.momen.app/graphql',
      }),
    ).toThrow('VITE_MOMEN_GRAPHQL_URL must use the https: protocol.')

    expect(() =>
      getMomenConfig({
        ...validEnvironment,
        VITE_MOMEN_SUBSCRIPTION_URL:
          'wss://user@villa.momen.app/graphql-subscription',
      }),
    ).toThrow('VITE_MOMEN_SUBSCRIPTION_URL must not contain URL credentials.')
  })
})
