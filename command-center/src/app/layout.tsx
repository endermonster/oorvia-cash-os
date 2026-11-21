import type { Metadata } from 'next'
import Image from 'next/image'
import { Inter } from 'next/font/google'
import { LiquidGlass } from '@/components/LiquidGlass'
import map from '../../assets/plates/map.png'
import './globals.css'

const inter = Inter({ variable: '--font-inter', subsets: ['latin'], weight: ['400', '500', '600', '700', '800'] })

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
