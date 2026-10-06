type MomenEndpointEnvironment = Pick<
  ImportMetaEnv,
  'VITE_MOMEN_GRAPHQL_URL' | 'VITE_MOMEN_SUBSCRIPTION_URL'
>

export interface MomenConfig {
  readonly graphqlUrl: string
  readonly subscriptionUrl: string
}

function parseEndpoint(
  value: string | undefined,
  variableName: string,
  expectedProtocol: 'https:' | 'wss:',
): string {
  if (!value) {
    throw new Error(`Missing required environment variable ${variableName}.`)
  }

  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw new Error(`${variableName} must be a valid URL.`, { cause: error })
  }

  if (url.protocol !== expectedProtocol) {
    throw new Error(`${variableName} must use the ${expectedProtocol} protocol.`)
  }

  if (url.username || url.password) {
    throw new Error(`${variableName} must not contain URL credentials.`)
  }

  return url.href
}

export function getMomenConfig(
  environment: MomenEndpointEnvironment = import.meta.env,
): MomenConfig {
  return Object.freeze({
    graphqlUrl: parseEndpoint(
      environment.VITE_MOMEN_GRAPHQL_URL,
      'VITE_MOMEN_GRAPHQL_URL',
      'https:',
    ),
    subscriptionUrl: parseEndpoint(
      environment.VITE_MOMEN_SUBSCRIPTION_URL,
      'VITE_MOMEN_SUBSCRIPTION_URL',
      'wss:',
    ),
  })
}
