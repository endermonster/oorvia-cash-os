import { readView, type Tab } from '@/lib/nav'
import { TopBar } from './TopBar'

/** Tabs that exist in the plan but are not built yet. Says what will be here. */
export async function Later({ tab, title, items, searchParams }: { tab: Tab; title: string; items: string[]; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const view = readView(await searchParams)
  return (
    <>
      <TopBar tab={tab} view={view} />
      <main className="mx-auto max-w-[1440px] px-4 py-16 sm:px-8 lg:px-10">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">{title}</h1>
        <p className="mt-3 max-w-[60ch] text-ink-2">Not built yet. Home comes first; this tab follows once Home is signed off. It will hold:</p>
        <ul className="mt-6 max-w-[60ch] list-disc space-y-2 pl-5 text-ink-2 marker:text-ink-3">
          {items.map((i) => <li key={i}>{i}</li>)}
        </ul>
      </main>
    </>
  )
}
