// Tailwind runs through the @tailwindcss/turbopack loader (next.config.ts), not PostCSS. This file exists so
// Turbopack stops here instead of climbing to the repo root's postcss.config.mjs, which belongs to Cash OS and
// needs @tailwindcss/postcss — not installed in this app, so Vercel's git builds failed without it.
export default { plugins: {} }
