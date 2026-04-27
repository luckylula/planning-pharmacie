'use client'

import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

type LoginEmployee = {
  id: string
  name: string
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
      setError('Employe ou code incorrect')
    } else {
      const session = await fetch('/api/auth/session').then((r) => r.json())
      if (session?.user?.role === 'admin') router.push('/admin')
      else router.push('/admin?tab=calendar')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white border border-gray-200 rounded-xl p-8 w-full max-w-sm shadow-sm">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🏥</div>
          <h1 className="text-lg font-semibold text-gray-900">Planning Pharmacie</h1>
          <p className="text-sm text-gray-500 mt-1">Selectionnez votre nom et saisissez votre code</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Employe</label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              required
            >
              {employees.length === 0 && <option value="">Aucun employe disponible</option>}
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Code</label>
            <input
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              required
            />
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg text-sm transition-colors disabled:opacity-60"
          >
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  )
}
