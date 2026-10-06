// Anonymous-only endpoint probe. Never reads or sends MOMEN_ADMIN_TOKEN.
const graphqlUrl = process.env.VITE_MOMEN_GRAPHQL_URL

if (!graphqlUrl) {
  console.error('VITE_MOMEN_GRAPHQL_URL is not set (copy .env.example to .env.local).')
  process.exit(2)
}

let endpoint
try {
  endpoint = new URL(graphqlUrl)
} catch (error) {
  console.error(
    `VITE_MOMEN_GRAPHQL_URL must be a valid URL (${error instanceof Error ? error.message : 'invalid URL'}).`,
  )
  process.exit(2)
}

if (endpoint.protocol !== 'https:') {
  console.error('VITE_MOMEN_GRAPHQL_URL must use HTTPS.')
  process.exit(2)
}

try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ __typename }' }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    console.error(`Momen anonymous probe failed: HTTP ${response.status}.`)
    process.exitCode = 1
  } else {
    const result = await response.json()
    const hasErrors =
      typeof result === 'object' &&
      result !== null &&
      'errors' in result &&
      Array.isArray(result.errors) &&
      result.errors.length > 0
    const hasTypename =
      typeof result === 'object' &&
      result !== null &&
      'data' in result &&
      typeof result.data === 'object' &&
      result.data !== null &&
      '__typename' in result.data &&
      typeof result.data.__typename === 'string'

    if (hasErrors || !hasTypename) {
      console.error('Momen returned an unsuccessful GraphQL response.')
      process.exitCode = 1
    } else {
      console.log('Momen anonymous GraphQL probe succeeded.')
    }
  }
} catch (error) {
  console.error(
    `Momen anonymous probe failed (${error instanceof Error ? error.message : 'unknown error'}).`,
  )
  process.exitCode = 1
}
