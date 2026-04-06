'use client'

import { signOut } from 'next-auth/react'
import { useEffect, useMemo, useState } from 'react'
import { MONTHS_FR, formatDate, getDayOfWeek, getDaysInMonth, getShiftIdForDate, shiftHours, DAYS_FR } from '@/lib/schedule'
import { ScheduleData, Shift } from '@/types'

type MyData = ScheduleData & { employee: { id: string; name: string } | null }

function SlotBadge({ label, sh }: { label: string; sh: Shift | undefined }) {
  if (!sh || sh.isRepos) {
    return <span className="text-gray-400 text-xs">—</span>
  }
  return (
    <span className="inline-block px-2 py-1 rounded text-xs" style={{ backgroundColor: sh.bgColor, color: sh.fgColor }}>
      <span className="opacity-70 mr-1">{label}</span>
      {sh.shortCode}
    </span>
  )
}

export default function MonHorairePage() {
  const [data, setData] = useState<MyData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    void fetch('/api/mon-horaire')
      .then(async (r) => {
        const d = (await r.json()) as MyData & { error?: string }
        if (!r.ok) {
          setLoadError(typeof d.error === 'string' ? d.error : `Erreur ${r.status}`)
          return
        }
        if (!d.employee) {
          setLoadError("Aucun employé n'est associé à ce compte. Contactez un administrateur.")
          return
        }
        setData(d)
      })
      .catch(() => setLoadError('Impossible de joindre le serveur. Vérifiez la connexion et réessayez.'))
  }, [])

  const ranges = useMemo(() => {
    const now = new Date()
    const thisMonth = { year: now.getFullYear(), month: now.getMonth() }
    const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const nextMonth = { year: nextDate.getFullYear(), month: nextDate.getMonth() }
    return [thisMonth, nextMonth]
  }, [])

  if (loadError) {
    return (
      <div className="p-6 max-w-lg space-y-3">
        <p className="text-red-700">{loadError}</p>
        <button type="button" onClick={() => signOut({ callbackUrl: '/login' })} className="px-3 py-2 text-sm bg-gray-900 text-white rounded-lg">
          Retour à la connexion
        </button>
      </div>
    )
  }

  if (!data) return <div className="p-6">Chargement...</div>

  if (!data.employee) {
    return (
      <div className="p-6 max-w-lg space-y-3">
        <p className="text-gray-800">Aucun employé n’est associé à ce compte.</p>
        <button type="button" onClick={() => signOut({ callbackUrl: '/login' })} className="px-3 py-2 text-sm bg-gray-900 text-white rounded-lg">
          Retour à la connexion
        </button>
      </div>
    )
  }

  const repos = data.shifts.find((s) => s.isRepos) || data.shifts[0]
  const byId = Object.fromEntries(data.shifts.map((s: Shift) => [s.id, s]))
  const cycleStart = data.cycleConfig ? new Date(data.cycleConfig.startDate) : new Date('2026-03-02')

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Horaire de {data.employee.name}</h1>
        <button onClick={() => signOut({ callbackUrl: '/login' })} className="ml-auto px-3 py-2 text-sm bg-gray-900 text-white rounded-lg">
          Se deconnecter
        </button>
      </div>
      {ranges.map(({ year, month }) => {
        const days = getDaysInMonth(year, month)
        const total = days.reduce((acc, d) => {
          const sidM = getShiftIdForDate(data.employee!.id, d, 'MATIN', data.patternCells, data.overrides, cycleStart, repos.id)
          const sidA = getShiftIdForDate(data.employee!.id, d, 'APREM', data.patternCells, data.overrides, cycleStart, repos.id)
          return acc + shiftHours(byId[sidM]) + shiftHours(byId[sidA])
        }, 0)
        return (
          <div key={`${year}-${month}`} className="border rounded-xl overflow-hidden">
            <div className="bg-gray-100 px-4 py-2 font-medium">{MONTHS_FR[month]} {year}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left p-2">Jour</th>
                    <th className="text-left p-2">Matin / Après-midi</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => {
                    const sidM = getShiftIdForDate(data.employee!.id, d, 'MATIN', data.patternCells, data.overrides, cycleStart, repos.id)
                    const sidA = getShiftIdForDate(data.employee!.id, d, 'APREM', data.patternCells, data.overrides, cycleStart, repos.id)
                    const sM = byId[sidM]
                    const sA = byId[sidA]
                    const wd = getDayOfWeek(d)
                    return (
                      <tr key={d.toISOString()} className="border-t">
                        <td className="p-2 whitespace-nowrap">{DAYS_FR[wd]} {d.getDate()} ({formatDate(d)})</td>
                        <td className="p-2">
                          <div className="flex flex-col gap-1">
                            <SlotBadge label="M" sh={sM} />
                            <SlotBadge label="T" sh={sA} />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 bg-gray-50 text-sm font-medium">Total heures: {total.toFixed(2)}h</div>
          </div>
        )
      })}
    </div>
  )
}
