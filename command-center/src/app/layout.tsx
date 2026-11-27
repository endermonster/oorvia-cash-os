import type { Metadata } from 'next'
import Image from 'next/image'
import { Inter } from 'next/font/google'
import { LiquidGlass } from '@/components/LiquidGlass'
import map from '../../assets/plates/map.png'
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
      <body>
        {/* What the glass bends: the plains at night, close enough that it reads as city light, not a second map. */}
        <div aria-hidden className="night fixed inset-0">
          <Image src={map} alt="" fill priority sizes="100vw" className="night-lights" />
        </div>
        {children}
        <LiquidGlass />
      </body>
    </html>
  )
}
