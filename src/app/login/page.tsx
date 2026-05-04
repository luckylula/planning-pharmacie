'use client'

import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useState } from 'react'

type LoginEmployee = {
  id: string
  name: string
}

function BrandMark({ className }: { className?: string }) {
  const gid = useId().replace(/:/g, '')
  const gradId = `brand-grad-${gid}`
  return (
    <svg
      className={className}
      viewBox="0 0 56 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="10" y1="6" x2="48" y2="52" gradientUnits="userSpaceOnUse">
          <stop stopColor="#059669" />
          <stop offset="0.5" stopColor="#16a34a" />
          <stop offset="1" stopColor="#047857" />
        </linearGradient>
      </defs>
      <rect width="56" height="56" rx="15" fill={`url(#${gradId})`} />
      <path
        d="M17 23h22v17a2.5 2.5 0 01-2.5 2.5H19.5A2.5 2.5 0 0117 40V23z"
        stroke="white"
        strokeWidth="2"
        strokeLinejoin="round"
        fill="rgba(255,255,255,0.12)"
      />
      <path
        d="M17 23v-3.5A2.5 2.5 0 0119.5 17h3v4M39 23v-3.5A2.5 2.5 0 0036.5 17h-3v4M15 27h26"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect x="21.5" y="31" width="13" height="3.2" rx="1.6" fill="white" opacity="0.95" />
      <rect x="21.5" y="36.5" width="9" height="3.2" rx="1.6" fill="white" opacity="0.72" />
    </svg>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const [employees, setEmployees] = useState<LoginEmployee[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const loadEmployees = async () => {
      try {
        const r = await fetch('/api/auth/login-employees')
        if (!r.ok) throw new Error('load failed')
        const d = (await r.json()) as { employees?: LoginEmployee[] }
        if (!cancelled) {
          const list = Array.isArray(d.employees) ? d.employees : []
          setEmployees(list)
          if (list.length > 0) setEmployeeId((prev) => prev || list[0].id)
        }
      } catch {
        if (!cancelled) setError("Impossible de charger la liste des employes.")
      }
    }
    void loadEmployees()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await signIn('credentials', {
      employeeId,
      code,
      redirect: false,
    })
    setLoading(false)
    if (res?.error) {
      setError('Employé ou code incorrect')
    } else {
      const session = await fetch('/api/auth/session').then((r) => r.json())
      if (session?.user?.role === 'admin') router.push('/admin')
      else router.push('/admin?tab=calendar')
    }
  }

  return (
    <div className="relative flex min-h-full flex-1 items-center justify-center overflow-hidden bg-[#f4f7fb] px-4 py-12">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(5,150,105,0.16),transparent)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -top-24 -left-24 h-[28rem] w-[28rem] rounded-full bg-emerald-400/25 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-32 -right-24 h-[26rem] w-[26rem] rounded-full bg-green-500/18 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute top-1/2 left-1/2 h-[min(90vw,42rem)] w-[min(90vw,42rem)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-200/60 opacity-60"
        aria-hidden
      />

      <div className="relative w-full max-w-[420px]">
        <div className="rounded-[1.75rem] border border-white/70 bg-white/75 p-8 shadow-[0_24px_80px_-24px_rgba(15,23,42,0.18)] backdrop-blur-xl md:p-10">
          <header className="mb-8 text-center">
            <div className="mx-auto mb-5 flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-2xl shadow-lg shadow-emerald-900/12 ring-1 ring-white/80">
              <BrandMark className="h-14 w-14 drop-shadow-sm" />
            </div>
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-emerald-700/90">
              Espace équipe
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 md:text-[1.65rem] leading-tight">
              Planning
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              Sélectionnez votre nom et saisissez votre code personnel pour accéder au planning.
            </p>
          </header>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="login-employee" className="block text-xs font-medium text-slate-600">
                Employé
              </label>
              <select
                id="login-employee"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-full rounded-xl border border-slate-200/90 bg-slate-50/80 px-3.5 py-2.5 text-sm text-slate-900 shadow-inner shadow-white/50 placeholder:text-slate-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/35"
                required
              >
                {employees.length === 0 && <option value="">Aucun employé disponible</option>}
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="login-code" className="block text-xs font-medium text-slate-600">
                Code
              </label>
              <input
                id="login-code"
                type="password"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="current-password"
                className="w-full rounded-xl border border-slate-200/90 bg-slate-50/80 px-3.5 py-2.5 text-sm text-slate-900 shadow-inner shadow-white/50 placeholder:text-slate-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/35"
                required
              />
            </div>
            {error && (
              <p
                role="alert"
                className="rounded-xl border border-red-100 bg-red-50/90 px-3.5 py-2.5 text-xs leading-relaxed text-red-700"
              >
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-emerald-600 via-green-600 to-emerald-700 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-900/20 transition-[filter,opacity] hover:brightness-[1.03] active:brightness-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="relative z-10">{loading ? 'Connexion…' : 'Se connecter'}</span>
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Connexion sécurisée — vos données restent internes à la pharmacie.
        </p>
      </div>
    </div>
  )
}
