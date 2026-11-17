import type { Metadata } from 'next'
import { Manrope } from 'next/font/google'
import './globals.css'

const manrope = Manrope({ variable: '--font-manrope', subsets: ['latin'], weight: ['400', '500', '600', '700', '800'] })

export const metadata: Metadata = {
  title: 'VXP Command Center',
  description: 'Private profit cockpit for Oorvia, Kaiven and Selnova',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en-IN" className={`${manrope.variable} antialiased`}>
      <body>{children}</body>
    </html>
  )
}
