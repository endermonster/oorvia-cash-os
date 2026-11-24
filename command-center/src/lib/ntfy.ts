import 'server-only'

/** ntfy priorities: 4 = high (sound, heads-up), 3 = default, 2 = low. */
export type NtfyPriority = 2 | 3 | 4

/**
 * Pushes one message to Vedaant's phone through ntfy.sh. The topic name is the only secret (anyone who knows it can read
 * and post), so it lives in NTFY_TOPIC and is never logged. JSON publish, so ₹ in the title and body is fine.
 * Throws when NTFY_TOPIC is unset or ntfy refuses: the caller keeps its alert state and retries next run.
 */
export async function notify(msg: { title: string; body: string; priority: NtfyPriority; tags?: string[] }, timeoutMs = 10_000): Promise<void> {
  const topic = process.env.NTFY_TOPIC
  if (!topic) throw new Error('NTFY_TOPIC is not set')
  const res = await fetch('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, title: msg.title, message: msg.body, priority: msg.priority, tags: msg.tags ?? [] }),
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`ntfy answered ${res.status}`)
}
