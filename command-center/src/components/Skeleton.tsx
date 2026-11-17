export function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="mx-auto max-w-[1440px] px-4 pt-24 sm:px-8 lg:px-10">
      <div className="h-4 w-56 animate-pulse rounded bg-raised" />
      <div className="mt-4 h-20 w-80 animate-pulse rounded-lg bg-raised" />
      <div className="mt-14 h-72 animate-pulse rounded-xl bg-raised" />
    </div>
  )
}
