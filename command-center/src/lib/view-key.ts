/** Key of the store × period link table the top bar hands its switches (components/ViewSwitches.tsx). */
export const viewKey = (v: { store: string; period: string }) => `${v.store}|${v.period}`
