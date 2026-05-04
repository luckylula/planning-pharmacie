import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Planning · Pharmacie Bideau',
  description: 'Gestion des horaires — Pharmacie Bideau',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className={`${inter.className} flex min-h-full flex-col`}>
        <header
          role="banner"
          className="sticky top-0 z-[100] flex h-11 shrink-0 items-center justify-center border-b border-emerald-900/30 bg-gradient-to-r from-emerald-700 via-emerald-700 to-green-700 px-4 text-center text-base font-semibold leading-none tracking-[0.11em] text-white shadow-sm shadow-emerald-950/20"
        >
          Pharmacie Bideau
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </body>
    </html>
  )
}
