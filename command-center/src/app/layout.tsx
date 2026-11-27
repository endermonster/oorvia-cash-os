import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

// Variable Inter with its optical-size axis: big figures and the verdict get the tighter display cut on their own.
const inter = Inter({ variable: '--font-inter', subsets: ['latin'], axes: ['opsz'] })

export const metadata: Metadata = {
  title: 'VXP Command Center',
  description: 'Private profit cockpit for Oorvia, Kaiven and Selnova',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en-IN" className={`${inter.variable} antialiased`}>
      <body>{children}</body>
    </html>
  )
}
