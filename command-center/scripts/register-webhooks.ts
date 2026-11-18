// Subscribes each store to orders/create, orders/updated and orders/cancelled, pointing at the webhook route.
// Idempotent: lists existing subscriptions first and only creates the missing ones.
// Run: NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/register-webhooks.ts --url https://host/api/webhooks/shopify [--store kaiven|all]
import { allStoreIds, gql } from '../src/lib/shopify/client'

const TOPICS = ['ORDERS_CREATE', 'ORDERS_UPDATED', 'ORDERS_CANCELLED'] as const

const LIST = `query { webhookSubscriptions(first: 100) { nodes { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } } }`
const CREATE = `mutation ($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) { webhookSubscription { id } userErrors { field message } }
}`

type ListData = { webhookSubscriptions: { nodes: { id: string; topic: string; endpoint: { callbackUrl?: string } }[] } }
type CreateData = { webhookSubscriptionCreate: { webhookSubscription: { id: string } | null; userErrors: { message: string }[] } }

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const url = arg('url')
  if (!url || !/^https:\/\//.test(url)) {
    console.error('Usage: --url https://host/api/webhooks/shopify [--store kaiven|all]')
    process.exit(2)
  }
  const store = arg('store') ?? 'all'
  const ids = store === 'all' ? await allStoreIds() : [store]

  for (const id of ids) {
    const existing = (await gql<ListData>(id, LIST)).webhookSubscriptions.nodes
    for (const topic of TOPICS) {
      if (existing.some((w) => w.topic === topic && w.endpoint?.callbackUrl === url)) {
        console.log(id, topic, 'already registered')
        continue
      }
      const r = (await gql<CreateData>(id, CREATE, { topic, sub: { uri: url, format: 'JSON' } })).webhookSubscriptionCreate
      if (r.userErrors.length > 0) throw new Error(`${id} ${topic}: ${r.userErrors.map((e) => e.message).join('; ')}`)
      console.log(id, topic, 'registered')
    }
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
