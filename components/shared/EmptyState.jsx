export default function EmptyState({ message = 'No data yet.', action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="text-zinc-700 mb-3">
        <rect x="5" y="8" width="30" height="26" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M13 18h14M13 24h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <p className="text-sm text-zinc-500">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
