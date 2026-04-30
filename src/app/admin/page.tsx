'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { signOut } from 'next-auth/react'
import { jsPDF } from 'jspdf'
import * as XLSX from 'xlsx'
import { CycleConfig, Employee, ScheduleData, Shift, Slot } from '@/types'
import { DAYS_FR, MONTHS_FR, formatDate, getDayOfWeek, getDaysInMonth, getShiftIdForDate, parseLocalDate, shiftHours } from '@/lib/schedule'

/** Matin 8h30–12h15 → 510–735. Chevauchement : shiftStart < franjaEnd && shiftEnd > franjaStart */
function coversWeekMatin(sh: Shift | undefined): boolean {
  if (!sh || sh.isRepos || sh.startHour == null || sh.endHour == null) return false
  const shiftStart = sh.startHour * 60 + (sh.startMin ?? 0)
  const shiftEnd = sh.endHour * 60 + (sh.endMin ?? 0)
  return shiftStart < 735 && shiftEnd > 510
}

/** Après-midi 14h00–19h15 → 840–1155 */
function coversWeekApresMidi(sh: Shift | undefined): boolean {
  if (!sh || sh.isRepos || sh.startHour == null || sh.endHour == null) return false
  const shiftStart = sh.startHour * 60 + (sh.startMin ?? 0)
  const shiftEnd = sh.endHour * 60 + (sh.endMin ?? 0)
  return shiftStart < 1155 && shiftEnd > 840
}

type Tab = 'calendar' | 'week' | 'consult' | 'pattern' | 'employees' | 'shifts'

type ConsultPeriodMode = 'week' | 'month' | 'custom'

function eachDayInRangeInclusive(start: Date, end: Date): Date[] {
  const out: Date[] = []
  const d = new Date(start)
  d.setHours(0, 0, 0, 0)
  const e = new Date(end)
  e.setHours(0, 0, 0, 0)
  while (d.getTime() <= e.getTime()) {
    out.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

function startOfWeekMonday(ref: Date): Date {
  const d = new Date(ref)
  d.setHours(0, 0, 0, 0)
  const wd = getDayOfWeek(d)
  d.setDate(d.getDate() - wd)
  return d
}

function formatWeekRangeFr(start: Date): string {
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const sm = MONTHS_FR[start.getMonth()]
  const em = MONTHS_FR[end.getMonth()]
  const sy = start.getFullYear()
  const ey = end.getFullYear()
  if (start.getMonth() === end.getMonth() && sy === ey) {
    return `Semaine du ${start.getDate()} au ${end.getDate()} ${sm} ${ey}`
  }
  if (sy === ey) {
    return `Semaine du ${start.getDate()} ${sm} au ${end.getDate()} ${em} ${ey}`
  }
  return `Semaine du ${start.getDate()} ${sm} ${sy} au ${end.getDate()} ${em} ${ey}`
}

const DAYS_FR_FULL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']

function formatDayTitleFr(d: Date): string {
  const wd = getDayOfWeek(d)
  return `${DAYS_FR_FULL[wd]} ${d.getDate()} ${MONTHS_FR[d.getMonth()].toLowerCase()} ${d.getFullYear()}`
}

function getMonthGridDates(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const start = startOfWeekMonday(first)
  const out: Date[] = []
  const cursor = new Date(start)
  for (let i = 0; i < 42; i++) {
    out.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

function truncateHolidayLabel(name: string, maxLen = 12): string {
  if (name.length <= maxLen) return name
  return `${name.slice(0, maxLen)}…`
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Valeur pour input[type=time] (HH:MM). Vide si horaire absent. */
function shiftTimeToInputValue(hour: number | null, min: number | null): string {
  if (hour == null || min == null) return ''
  return `${pad2(hour)}:${pad2(min)}`
}

function parseTimeInput(value: string): { hour: number; min: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const hour = Number(m[1])
  const min = Number(m[2])
  if (!Number.isInteger(hour) || !Number.isInteger(min)) return null
  if (hour < 0 || hour > 23 || min < 0 || min > 59) return null
  return { hour, min }
}

function buildShiftShortCode(label: string): string {
  const words = label
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return 'CRN'
  if (words.length === 1) return words[0].slice(0, 4)
  return words.slice(0, 3).map((w) => w[0]).join('')
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '').trim()
  if (h.length === 3) {
    return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
  }
  if (h.length !== 6) return [200, 200, 200]
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

type WeekViewMode = 'day' | 'week' | 'month' | 'calendar'

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('calendar')
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [sessionEmployeeId, setSessionEmployeeId] = useState<string | null>(null)
  const [calendarEmployeeFocus, setCalendarEmployeeFocus] = useState<'all' | string>('all')
  const [data, setData] = useState<ScheduleData | null>(null)
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth())
  const [picker, setPicker] = useState<{
    key: string
    left: number
    top?: number
    bottom?: number
    openUpward: boolean
    date?: string
    employeeId?: string
    dayIndex?: number
    slot?: Slot
  } | null>(null)
  const [newShift, setNewShift] = useState<Partial<Shift>>({ label: '', shortCode: '', bgColor: '#eeeeee', fgColor: '#757575' })
  const [newShiftTime, setNewShiftTime] = useState({ debut: '09:00', fin: '12:30' })
  const [newEmp, setNewEmp] = useState({ name: '', color: '#607d8b', email: '', password: '' })
  const [employeeAccessDrafts, setEmployeeAccessDrafts] = useState<Record<string, { email: string; password: string }>>({})
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMonday(new Date()))
  const [weekViewMode, setWeekViewMode] = useState<WeekViewMode>('week')
  const [dayViewDate, setDayViewDate] = useState<Date>(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })
  const [monthViewYear, setMonthViewYear] = useState(() => new Date().getFullYear())
  const [monthViewMonth, setMonthViewMonth] = useState(() => new Date().getMonth())
  const [consultMode, setConsultMode] = useState<ConsultPeriodMode>('week')
  const [consultCustomFrom, setConsultCustomFrom] = useState(() => {
    const n = new Date()
    return formatDate(new Date(n.getFullYear(), n.getMonth(), 1))
  })
  const [consultCustomTo, setConsultCustomTo] = useState(() => {
    const n = new Date()
    return formatDate(new Date(n.getFullYear(), n.getMonth() + 1, 0))
  })
  const [consultEmployeeFilter, setConsultEmployeeFilter] = useState<'all' | string>('all')
  const [holidayMap, setHolidayMap] = useState<Record<string, string>>({})
  const holidayFetchedYearsRef = useRef<Set<number>>(new Set())
  const pickerPopoverRef = useRef<HTMLDivElement | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reloadScheduleData = useCallback(async () => {
    setLoadError(null)
    try {
      const r = await fetch('/api/schedule/data')
      const d = (await r.json()) as ScheduleData & { error?: string }
      if (!r.ok) {
        setLoadError(typeof d.error === 'string' ? d.error : `Erreur ${r.status}`)
        return
      }
      if (Array.isArray(d.employees) && Array.isArray(d.shifts)) {
        setData(d)
      } else {
        setLoadError('Données invalides reçues du serveur.')
      }
    } catch {
      setLoadError('Impossible de joindre le serveur. Vérifiez la base de données (DATABASE_URL) et réessayez.')
    }
  }, [])

  useEffect(() => {
    void reloadScheduleData()
  }, [reloadScheduleData])

  useEffect(() => {
    void fetch('/api/auth/session')
      .then((r) => r.json())
      .then((s) => {
        setIsAdmin((s?.user?.role ?? '') === 'admin')
        const sid = typeof s?.user?.employeeId === 'string' ? s.user.employeeId : null
        setSessionEmployeeId(sid)
        if ((s?.user?.role ?? '') !== 'admin' && sid) {
          setCalendarEmployeeFocus(sid)
        }
      })
      .catch(() => setIsAdmin(false))
  }, [])

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null
    if (t && ['calendar', 'week', 'consult', 'pattern', 'employees', 'shifts'].includes(t)) setTab(t)
  }, [])

  useEffect(() => {
    if (isAdmin === false && ['pattern', 'employees', 'shifts'].includes(tab)) {
      setTab('calendar')
    }
  }, [isAdmin, tab])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const t = e.target
      if (t instanceof Node && pickerPopoverRef.current?.contains(t)) return
      setPicker(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  useEffect(() => {
    if (!data) return
    const drafts: Record<string, { email: string; password: string }> = {}
    for (const e of data.employees) {
      drafts[e.id] = { email: e.user?.email ?? '', password: '' }
    }
    setEmployeeAccessDrafts(drafts)
  }, [data])

  const reposShift = useMemo(() => data?.shifts.find((s) => s.isRepos) ?? data?.shifts[0], [data])
  const cycleStart = useMemo(() => (data?.cycleConfig ? new Date(data.cycleConfig.startDate) : new Date('2026-03-02')), [data])
  const days = useMemo(() => getDaysInMonth(year, month), [year, month])

  const monthViewWeeks = useMemo(() => {
    const monthGrid = getMonthGridDates(monthViewYear, monthViewMonth)
    const weeks: Date[][] = []
    for (let w = 0; w < 6; w++) {
      const weekDays = monthGrid.slice(w * 7, w * 7 + 7)
      const hasAnyDayInMonth = weekDays.some(
        (d) => d.getMonth() === monthViewMonth && d.getFullYear() === monthViewYear
      )
      if (!hasAnyDayInMonth) continue
      weeks.push(weekDays)
    }
    return weeks
  }, [monthViewYear, monthViewMonth])

  const orderedEmployees = useMemo(() => {
    if (!data) return []
    const norman = data.employees.find((e) => e.name.trim().toLowerCase() === 'norman')
    const withoutNorman = norman ? data.employees.filter((e) => e.id !== norman.id) : data.employees

    let ordered = withoutNorman
    if (sessionEmployeeId) {
      const mine = withoutNorman.find((e) => e.id === sessionEmployeeId)
      if (mine) {
        ordered = [mine, ...withoutNorman.filter((e) => e.id !== sessionEmployeeId)]
      }
    }

    return norman ? [...ordered, norman] : ordered
  }, [data, sessionEmployeeId])

  const calendarEmployees = useMemo(() => {
    if (!data) return []
    if (calendarEmployeeFocus === 'all') return orderedEmployees
    const only = orderedEmployees.find((e) => e.id === calendarEmployeeFocus)
    return only ? [only] : orderedEmployees
  }, [data, calendarEmployeeFocus, orderedEmployees])

  const calendarTableMinWidth = useMemo(() => {
    // Keep the table compact when one employee is selected.
    const px = 200 + calendarEmployees.length * 160
    return `${Math.max(380, px)}px`
  }, [calendarEmployees.length])

  useEffect(() => {
    if (!data) return
    if (calendarEmployeeFocus !== 'all' && !data.employees.some((e) => e.id === calendarEmployeeFocus)) {
      setCalendarEmployeeFocus('all')
    }
  }, [data, calendarEmployeeFocus])

  const consultRange = useMemo(() => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    if (consultMode === 'week') {
      const s = startOfWeekMonday(new Date())
      const e = new Date(s)
      e.setDate(e.getDate() + 6)
      return { start: s, end: e }
    }
    if (consultMode === 'month') {
      const s = new Date(now.getFullYear(), now.getMonth(), 1)
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return { start: s, end: e }
    }
    const s = parseLocalDate(consultCustomFrom)
    const e = parseLocalDate(consultCustomTo)
    s.setHours(0, 0, 0, 0)
    e.setHours(0, 0, 0, 0)
    if (s.getTime() > e.getTime()) return { start: e, end: s }
    return { start: s, end: e }
  }, [consultMode, consultCustomFrom, consultCustomTo])

  const holidayYearsNeeded = useMemo(() => {
    const s = new Set<number>()
    const add = (d: Date) => s.add(d.getFullYear())
    add(new Date())
    s.add(year)
    s.add(monthViewYear)
    add(dayViewDate)
    add(weekStart)
    const wEnd = new Date(weekStart)
    wEnd.setDate(wEnd.getDate() + 6)
    add(wEnd)
    add(consultRange.start)
    add(consultRange.end)
    return [...s].sort((a, b) => a - b)
  }, [year, monthViewYear, dayViewDate, weekStart, consultRange])

  useEffect(() => {
    for (const y of holidayYearsNeeded) {
      if (holidayFetchedYearsRef.current.has(y)) continue
      holidayFetchedYearsRef.current.add(y)
      void fetch(`https://date.nager.at/api/v3/PublicHolidays/${y}/FR`)
        .then((r) => r.json())
        .then((arr: unknown) => {
          if (!Array.isArray(arr)) return
          setHolidayMap((prev) => {
            const next = { ...prev }
            for (const h of arr as { date?: string; localName?: string }[]) {
              if (h.date && h.localName) next[h.date] = h.localName
            }
            return next
          })
        })
        .catch(() => {
          holidayFetchedYearsRef.current.delete(y)
        })
    }
  }, [holidayYearsNeeded])

  const consultPeriodDays = useMemo(
    () => eachDayInRangeInclusive(consultRange.start, consultRange.end),
    [consultRange]
  )

  const consultStats = useMemo(() => {
    if (!data || !reposShift) return [] as { emp: Employee; totalHours: number; typeCounts: Record<string, number>; reposDays: number }[]
    const byId = Object.fromEntries(data.shifts.map((s) => [s.id, s]))
    const slots: Slot[] = ['MATIN', 'APREM']
    return data.employees.map((emp) => {
      let totalHours = 0
      const typeCounts: Record<string, number> = {}
      let reposDays = 0
      for (const d of consultPeriodDays) {
        let dayAllRepos = true
        for (const sl of slots) {
          const sid = getShiftIdForDate(emp.id, d, sl, data.patternCells, data.overrides, cycleStart, reposShift.id)
          const sh = byId[sid]
          if (sh?.isRepos) continue
          dayAllRepos = false
          totalHours += shiftHours(sh)
          const key = sh?.label || sh?.shortCode || '—'
          typeCounts[key] = (typeCounts[key] || 0) + 1
        }
        if (dayAllRepos) reposDays++
      }
      return { emp, totalHours, typeCounts, reposDays }
    })
  }, [data, reposShift, cycleStart, consultPeriodDays])

  const consultTeamTotalHours = useMemo(
    () => consultStats.reduce((acc, s) => acc + s.totalHours, 0),
    [consultStats]
  )

  const consultAvgHoursPerEmployee = useMemo(
    () => (consultStats.length ? consultTeamTotalHours / consultStats.length : 0),
    [consultStats, consultTeamTotalHours]
  )

  useEffect(() => {
    if (consultEmployeeFilter === 'all' || !data) return
    if (!data.employees.some((e) => e.id === consultEmployeeFilter)) {
      setConsultEmployeeFilter('all')
    }
  }, [data, consultEmployeeFilter])

  const consultFilteredStats = useMemo(() => {
    if (consultEmployeeFilter === 'all') return consultStats
    return consultStats.filter((r) => r.emp.id === consultEmployeeFilter)
  }, [consultStats, consultEmployeeFilter])

  const consultFilteredMaxHours = useMemo(
    () => Math.max(0.001, ...consultFilteredStats.map((s) => s.totalHours)),
    [consultFilteredStats]
  )

  if (loadError) {
    return (
      <div className="p-6 max-w-lg space-y-3">
        <p className="text-red-700">{loadError}</p>
        <button type="button" onClick={() => void reloadScheduleData()} className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg">
          Réessayer
        </button>
      </div>
    )
  }

  if (!data) return <div className="p-6">Chargement...</div>

  if (data.shifts.length === 0) {
    return (
      <div className="p-6 max-w-lg space-y-2">
        <p className="text-gray-800">Aucun créneau (shift) n’est défini. Ajoutez au moins un shift dont un « repos » dans l’onglet Créneaux.</p>
      </div>
    )
  }

  if (!reposShift) {
    return <div className="p-6 text-red-700">Erreur interne : impossible de déterminer le créneau repos.</div>
  }

  const shiftById = Object.fromEntries(data.shifts.map((s) => [s.id, s]))
  const pickerShifts = !picker?.slot
    ? data.shifts
    : data.shifts.filter((s) => {
        if (s.isRepos) return true
        return picker.slot === 'MATIN' ? coversWeekMatin(s) : coversWeekApresMidi(s)
      })

  const updatePattern = async (dayIndex: number, employeeId: string, shiftId: string, slot: Slot) => {
    const prev = data.patternCells
    setData({
      ...data,
      patternCells: [
        ...prev.filter((p) => !(p.dayIndex === dayIndex && p.employeeId === employeeId && p.slot === slot)),
        { id: `tmp-${Date.now()}`, dayIndex, employeeId, shiftId, slot },
      ],
    })
    await fetch('/api/schedule/pattern', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dayIndex, employeeId, shiftId, slot }),
    })
  }

  const updateOverride = async (date: string, employeeId: string, shiftId: string | null, slot: Slot) => {
    const prev = data.overrides
    if (!shiftId) {
      setData({
        ...data,
        overrides: prev.filter(
          (o) => !(formatDate(new Date(o.date)) === date && o.employeeId === employeeId && o.slot === slot)
        ),
      })
      await fetch('/api/schedule/override', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, employeeId, slot }),
      })
      return
    }
    setData({
      ...data,
      overrides: [
        ...prev.filter(
          (o) => !(formatDate(new Date(o.date)) === date && o.employeeId === employeeId && o.slot === slot)
        ),
        { id: `tmp-${Date.now()}`, date, employeeId, shiftId, slot },
      ],
    })
    await fetch('/api/schedule/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, employeeId, shiftId, slot }),
    })
  }

  const exportCsv = () => {
    const header = ['Date', ...data.employees.map((e) => e.name)].join(';')
    const rows = days.map((d) => {
      const line = [formatDate(d)]
      for (const emp of data.employees) {
        const sidM = getShiftIdForDate(emp.id, d, 'MATIN', data.patternCells, data.overrides, cycleStart, reposShift.id)
        const sidA = getShiftIdForDate(emp.id, d, 'APREM', data.patternCells, data.overrides, cycleStart, reposShift.id)
        line.push(`${shiftById[sidM]?.shortCode ?? ''}/${shiftById[sidA]?.shortCode ?? ''}`)
      }
      return line.join(';')
    })
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `planning_${MONTHS_FR[month]}_${year}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportVueSemainePdf = (forcedMode?: WeekViewMode) => {
    const mode = forcedMode ?? weekViewMode
    const drawPdfFooter = (doc: jsPDF, pw: number, ph: number) => {
      doc.setFontSize(7)
      doc.setTextColor(100, 100, 100)
      doc.text(`Généré le ${new Date().toLocaleString('fr-FR')} — Planning Pharmacie`, pw / 2, ph - 4, { align: 'center' })
      doc.setTextColor(0, 0, 0)
    }

    const drawChip = (doc: jsPDF, x: number, y: number, w: number, emp: Employee, sh: Shift | undefined): number => {
      if (!sh || sh.isRepos) return y
      const h = 7
      const [r, g, b] = hexToRgb(sh.bgColor)
      const [fr, fg, fb] = hexToRgb(sh.fgColor)
      doc.setFillColor(r, g, b)
      doc.rect(x, y, w, h, 'F')
      doc.setDrawColor(200, 200, 200)
      doc.rect(x, y, w, h, 'S')
      doc.setTextColor(fr, fg, fb)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.text(emp.name.slice(0, 26), x + 1, y + 3.2)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.text(sh.shortCode, x + 1, y + 5.8)
      doc.setTextColor(0, 0, 0)
      return y + h + 1.2
    }

    if (mode === 'day') {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageW = doc.internal.pageSize.getWidth()
      const pageH = doc.internal.pageSize.getHeight()
      const margin = 12
      const dayDate = new Date(dayViewDate)
      dayDate.setHours(0, 0, 0, 0)
      const wd = getDayOfWeek(dayDate)
      const rows = data.employees.map((emp) => {
        const sidM = getShiftIdForDate(emp.id, dayDate, 'MATIN', data.patternCells, data.overrides, cycleStart, reposShift.id)
        const sidA = getShiftIdForDate(emp.id, dayDate, 'APREM', data.patternCells, data.overrides, cycleStart, reposShift.id)
        return { emp, shM: shiftById[sidM], shA: shiftById[sidA] }
      })
      const matinRows = rows.filter((r) => coversWeekMatin(r.shM))
      const apresRows = rows.filter((r) => coversWeekApresMidi(r.shA))
      const matinCount = matinRows.length
      const apresCount = apresRows.length
      const isSundayClosed = wd === 6 && matinCount === 0 && apresCount === 0

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(16)
      doc.text(formatDayTitleFr(dayDate), pageW / 2, margin + 8, { align: 'center' })
      doc.setFont('helvetica', 'normal')
      let y = margin + 20
      const chipW = pageW - margin * 2

      if (isSundayClosed) {
        doc.setFontSize(11)
        doc.setTextColor(120, 120, 120)
        doc.text('Fermé', pageW / 2, y + 20, { align: 'center' })
        doc.setTextColor(0, 0, 0)
      } else {
        doc.setFontSize(10)
        doc.setTextColor(140, 100, 40)
        doc.text('Matin 8h30–12h15', margin, y)
        y += 6
        doc.setTextColor(0, 0, 0)
        for (const { emp, shM } of matinRows) {
          y = drawChip(doc, margin, y, chipW, emp, shM)
        }
        y += 4
        doc.setDrawColor(200, 200, 200)
        doc.line(margin, y, pageW - margin, y)
        y += 6
        doc.setFontSize(10)
        doc.setTextColor(40, 90, 130)
        doc.text('Après-midi 14h00–19h15', margin, y)
        y += 6
        doc.setTextColor(0, 0, 0)
        for (const { emp, shA } of apresRows) {
          y = drawChip(doc, margin, y, chipW, emp, shA)
        }
      }

      drawPdfFooter(doc, pageW, pageH)
      doc.save(`vue_jour_${formatDate(dayDate)}.pdf`)
      return
    }

    if (mode === 'week') {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const pageW = doc.internal.pageSize.getWidth()
      const pageH = doc.internal.pageSize.getHeight()
      const margin = 7
      const colW = (pageW - margin * 2) / 7
      const innerW = colW - 2

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      doc.text(formatWeekRangeFr(weekStart), pageW / 2, margin + 8, { align: 'center' })
      doc.setFont('helvetica', 'normal')

      const baseY = margin + 14

      for (let i = 0; i < 7; i++) {
        const x = margin + i * colW
        const dayDate = new Date(weekStart)
        dayDate.setDate(weekStart.getDate() + i)
        dayDate.setHours(0, 0, 0, 0)
        const wd = getDayOfWeek(dayDate)
        const dayAbbr = DAYS_FR[wd].slice(0, 3)
        const rows = data.employees.map((emp) => {
          const sidM = getShiftIdForDate(emp.id, dayDate, 'MATIN', data.patternCells, data.overrides, cycleStart, reposShift.id)
          const sidA = getShiftIdForDate(emp.id, dayDate, 'APREM', data.patternCells, data.overrides, cycleStart, reposShift.id)
          return { emp, shM: shiftById[sidM], shA: shiftById[sidA] }
        })
        const matinRows = rows.filter((r) => coversWeekMatin(r.shM))
        const apresRows = rows.filter((r) => coversWeekApresMidi(r.shA))
        const matinCount = matinRows.length
        const apresCount = apresRows.length
        const isSundayClosed = wd === 6 && matinCount === 0 && apresCount === 0

        doc.setDrawColor(220, 220, 220)
        doc.rect(x, baseY, colW, pageH - baseY - margin - 8, 'S')

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.text(dayAbbr, x + colW / 2, baseY + 5, { align: 'center' })
        doc.setFontSize(10)
        doc.text(String(dayDate.getDate()), x + colW / 2, baseY + 10, { align: 'center' })
        doc.setFont('helvetica', 'normal')

        let cy = baseY + 14
        if (isSundayClosed) {
          doc.setFontSize(7)
          doc.setTextColor(150, 150, 150)
          doc.text('Fermé', x + colW / 2, cy + 10, { align: 'center' })
          doc.setTextColor(0, 0, 0)
        } else {
          doc.setFontSize(6.5)
          doc.setTextColor(130, 100, 40)
          doc.text('Matin', x + 1, cy)
          cy += 3.5
          doc.setTextColor(0, 0, 0)
          for (const { emp, shM } of matinRows) {
            cy = drawChip(doc, x + 1, cy, innerW, emp, shM)
          }
          cy += 1.5
          doc.setDrawColor(200, 200, 200)
          doc.line(x + 0.5, cy, x + colW - 0.5, cy)
          cy += 3
          doc.setFontSize(6.5)
          doc.setTextColor(40, 90, 130)
          doc.text('Après-midi', x + 1, cy)
          cy += 3.5
          doc.setTextColor(0, 0, 0)
          for (const { emp, shA } of apresRows) {
            cy = drawChip(doc, x + 1, cy, innerW, emp, shA)
          }
        }
      }

      drawPdfFooter(doc, pageW, pageH)
      doc.save(`vue_semaine_${formatDate(weekStart)}.pdf`)
      return
    }

    if (mode === 'calendar') {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const pageW = doc.internal.pageSize.getWidth()
      const pageH = doc.internal.pageSize.getHeight()
      const margin = 8
      const rowH = 6.5
      const dayColW = 26
      const colW = Math.max(14, (pageW - margin * 2 - dayColW) / data.employees.length)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      doc.text(`Calendrier ${MONTHS_FR[month]} ${year}`, pageW / 2, margin + 4, { align: 'center' })
      doc.setFont('helvetica', 'normal')

      const drawHeader = (y: number) => {
        doc.setFillColor(240, 240, 240)
        doc.rect(margin, y, dayColW, rowH, 'F')
        doc.rect(margin, y, dayColW, rowH, 'S')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.text('Jour', margin + 2, y + 4.3)
        data.employees.forEach((e, idx) => {
          const x = margin + dayColW + idx * colW
          doc.setFillColor(240, 240, 240)
          doc.rect(x, y, colW, rowH, 'F')
          doc.rect(x, y, colW, rowH, 'S')
          doc.text(e.name.slice(0, 14), x + 1.2, y + 4.3)
        })
        doc.setFont('helvetica', 'normal')
      }

      let y = margin + 10
      drawHeader(y)
      y += rowH

      for (const d of days) {
        if (y + rowH > pageH - 12) {
          drawPdfFooter(doc, pageW, pageH)
          doc.addPage()
          y = margin + 8
          drawHeader(y)
          y += rowH
        }

        const wd = getDayOfWeek(d)
        const dayLabel = `${DAYS_FR[wd]} ${d.getDate()}`
        const holidayName = holidayMap[formatDate(d)]
        if (holidayName) doc.setFillColor(254, 215, 215)
        else if (wd === 6) doc.setFillColor(254, 226, 226)
        else if (wd === 5) doc.setFillColor(237, 233, 254)
        else doc.setFillColor(255, 255, 255)
        // Fill the full row (day + all employee columns) for weekends/holidays.
        doc.rect(margin, y, dayColW + colW * data.employees.length, rowH, 'F')
        doc.rect(margin, y, dayColW, rowH, 'S')
        doc.setFontSize(7.5)
        doc.text(dayLabel, margin + 1.2, y + 4.3)

        data.employees.forEach((emp, idx) => {
          const x = margin + dayColW + idx * colW
          const sidM = getShiftIdForDate(emp.id, d, 'MATIN', data.patternCells, data.overrides, cycleStart, reposShift.id)
          const sidA = getShiftIdForDate(emp.id, d, 'APREM', data.patternCells, data.overrides, cycleStart, reposShift.id)
          const shortM = shiftById[sidM]?.isRepos ? '—' : shiftById[sidM]?.shortCode ?? '—'
          const shortA = shiftById[sidA]?.isRepos ? '—' : shiftById[sidA]?.shortCode ?? '—'
          doc.rect(x, y, colW, rowH, 'S')
          doc.text(`${shortM}/${shortA}`.slice(0, 12), x + 1.2, y + 4.3)
        })
        y += rowH
      }

      drawPdfFooter(doc, pageW, pageH)
      doc.save(`calendrier_${MONTHS_FR[month]}_${year}.pdf`)
      return
    }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const margin = 7
    const footerReserve = 10
    const weekHeaderBarH = 6
    const gapAfterWeek = 5
    const titleBlockH = 12
    const colW = (pageW - margin * 2) / 7
    const innerW = colW - 2
    const mo = MONTHS_FR[monthViewMonth]
    const title = `${mo.charAt(0).toUpperCase()}${mo.slice(1)} ${monthViewYear}`

    const monthGrid = getMonthGridDates(monthViewYear, monthViewMonth)
    const weeks: Date[][] = []
    for (let w = 0; w < 6; w++) {
      const weekDays = monthGrid.slice(w * 7, w * 7 + 7)
      const hasAnyDayInMonth = weekDays.some(
        (d) => d.getMonth() === monthViewMonth && d.getFullYear() === monthViewYear
      )
      if (!hasAnyDayInMonth) continue
      weeks.push(weekDays)
    }

    /** Hauteur totale du bloc semaine (barre grise + 7 colonnes + marge sous le bloc), repère 0 = haut du bloc. */
    const measureWeekBlockHeight = (weekDays: Date[]): number => {
      const innerTop = weekHeaderBarH + 2
      const baseY = innerTop
      let rowMax = baseY + 14
      for (let i = 0; i < 7; i++) {
        const dayDate = new Date(weekDays[i])
        dayDate.setHours(0, 0, 0, 0)
        const wd = getDayOfWeek(dayDate)
        const rows = data.employees.map((emp) => {
          const sidM = getShiftIdForDate(emp.id, dayDate, 'MATIN', data.patternCells, data.overrides, cycleStart, reposShift.id)
          const sidA = getShiftIdForDate(emp.id, dayDate, 'APREM', data.patternCells, data.overrides, cycleStart, reposShift.id)
          return { emp, shM: shiftById[sidM], shA: shiftById[sidA] }
        })
        const matinRows = rows.filter((r) => coversWeekMatin(r.shM))
        const apresRows = rows.filter((r) => coversWeekApresMidi(r.shA))
        const matinCount = matinRows.length
        const apresCount = apresRows.length
        const isSundayClosed = wd === 6 && matinCount === 0 && apresCount === 0
        let cy = baseY + 14
        if (isSundayClosed) {
          rowMax = Math.max(rowMax, cy + 14)
        } else {
          cy += 3.5
          cy += matinRows.length * 8.2
          cy += 1.5 + 3
          cy += 3.5
          cy += apresRows.length * 8.2
          rowMax = Math.max(rowMax, cy)
        }
      }
      return rowMax + gapAfterWeek
    }

    const drawMonthTitle = (yTop: number) => {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(14)
      doc.text(title, pageW / 2, yTop + 5, { align: 'center' })
      doc.setFont('helvetica', 'normal')
    }

    const drawWeekBlock = (weekDays: Date[], blockTop: number): number => {
      const blockH = measureWeekBlockHeight(weekDays)
      const rowMaxAbs = blockTop + blockH - gapAfterWeek

      const weekStart = new Date(weekDays[0])
      weekStart.setHours(0, 0, 0, 0)
      const barY = blockTop
      doc.setFillColor(235, 235, 235)
      doc.rect(margin, barY, pageW - margin * 2, weekHeaderBarH, 'F')
      doc.setDrawColor(200, 200, 200)
      doc.rect(margin, barY, pageW - margin * 2, weekHeaderBarH, 'S')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(55, 55, 55)
      doc.text(formatWeekRangeFr(weekStart), pageW / 2, barY + 4.2, { align: 'center' })
      doc.setTextColor(0, 0, 0)
      doc.setFont('helvetica', 'normal')

      const baseY = barY + weekHeaderBarH + 2
      for (let i = 0; i < 7; i++) {
        const x = margin + i * colW
        doc.setDrawColor(220, 220, 220)
        doc.rect(x, baseY, colW, rowMaxAbs - baseY, 'S')
      }

      for (let i = 0; i < 7; i++) {
        const dayDate = new Date(weekDays[i])
        dayDate.setHours(0, 0, 0, 0)
        const wd = getDayOfWeek(dayDate)
        const dayAbbr = DAYS_FR[wd].slice(0, 3)
        const inMonth = dayDate.getMonth() === monthViewMonth && dayDate.getFullYear() === monthViewYear
        const rows = data.employees.map((emp) => {
          const sidM = getShiftIdForDate(emp.id, dayDate, 'MATIN', data.patternCells, data.overrides, cycleStart, reposShift.id)
          const sidA = getShiftIdForDate(emp.id, dayDate, 'APREM', data.patternCells, data.overrides, cycleStart, reposShift.id)
          return { emp, shM: shiftById[sidM], shA: shiftById[sidA] }
        })
        const matinRows = rows.filter((r) => coversWeekMatin(r.shM))
        const apresRows = rows.filter((r) => coversWeekApresMidi(r.shA))
        const matinCount = matinRows.length
        const apresCount = apresRows.length
        const isSundayClosed = wd === 6 && matinCount === 0 && apresCount === 0

        const x = margin + i * colW
        let cy = baseY + 14

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.setTextColor(inMonth ? 30 : 170)
        doc.text(dayAbbr, x + colW / 2, baseY + 5, { align: 'center' })
        doc.setFontSize(10)
        doc.text(String(dayDate.getDate()), x + colW / 2, baseY + 10, { align: 'center' })
        doc.setTextColor(0, 0, 0)
        doc.setFont('helvetica', 'normal')

        if (isSundayClosed) {
          doc.setFontSize(7)
          doc.setTextColor(150, 150, 150)
          doc.text('Fermé', x + colW / 2, cy + 10, { align: 'center' })
          doc.setTextColor(0, 0, 0)
        } else {
          doc.setFontSize(6.5)
          doc.setTextColor(130, 100, 40)
          doc.text('Matin', x + 1, cy)
          cy += 3.5
          doc.setTextColor(0, 0, 0)
          for (const { emp, shM } of matinRows) {
            cy = drawChip(doc, x + 1, cy, innerW, emp, shM)
          }
          cy += 1.5
          doc.setDrawColor(200, 200, 200)
          doc.line(x + 0.5, cy, x + colW - 0.5, cy)
          cy += 3
          doc.setFontSize(6.5)
          doc.setTextColor(40, 90, 130)
          doc.text('Après-midi', x + 1, cy)
          cy += 3.5
          doc.setTextColor(0, 0, 0)
          for (const { emp, shA } of apresRows) {
            cy = drawChip(doc, x + 1, cy, innerW, emp, shA)
          }
        }
      }

      return blockTop + blockH
    }

    let yCursor = margin
    drawMonthTitle(yCursor)
    yCursor += titleBlockH

    for (const weekDays of weeks) {
      const estH = measureWeekBlockHeight(weekDays)
      if (yCursor + estH > pageH - footerReserve) {
        drawPdfFooter(doc, pageW, pageH)
        doc.addPage()
        yCursor = margin
        drawMonthTitle(yCursor)
        yCursor += titleBlockH
      }
      yCursor = drawWeekBlock(weekDays, yCursor)
    }

    drawPdfFooter(doc, pageW, pageH)
    doc.save(`vue_mois_${monthViewYear}_${String(monthViewMonth + 1).padStart(2, '0')}.pdf`)
  }

  const exportRecapHeures = () => {
    const periodStr = `${formatDate(consultRange.start)} au ${formatDate(consultRange.end)}`
    const allMode = consultEmployeeFilter === 'all'
    const employeesExport = allMode ? data.employees : data.employees.filter((e) => e.id === consultEmployeeFilter)
    const nEmp = employeesExport.length
    const rows: (string | number)[][] = []
    rows.push([`Récapitulatif des heures – ${periodStr}`])
    rows.push([])
    rows.push(['Employée', 'Jours travaillés', 'H. Matin', 'H. Après-midi', 'Total heures'])

    let sumJours = 0
    let sumMatin = 0
    let sumAprem = 0
    let sumTotal = 0

    for (const emp of employeesExport) {
      let jours = 0
      let hM = 0
      let hA = 0
      for (const d of consultPeriodDays) {
        const sidM = getShiftIdForDate(emp.id, d, 'MATIN', data.patternCells, data.overrides, cycleStart, reposShift.id)
        const sidA = getShiftIdForDate(emp.id, d, 'APREM', data.patternCells, data.overrides, cycleStart, reposShift.id)
        const shM = shiftById[sidM]
        const shA = shiftById[sidA]
        const mRepos = shM?.isRepos
        const aRepos = shA?.isRepos
        if (!mRepos) hM += shiftHours(shM)
        if (!aRepos) hA += shiftHours(shA)
        if (!(mRepos && aRepos)) jours++
      }
      const total = hM + hA
      sumJours += jours
      sumMatin += hM
      sumAprem += hA
      sumTotal += total
      rows.push([emp.name, jours, Math.round(hM * 100) / 100, Math.round(hA * 100) / 100, Math.round(total * 100) / 100])
    }

    if (allMode) {
      rows.push([
        'Total',
        sumJours,
        Math.round(sumMatin * 100) / 100,
        Math.round(sumAprem * 100) / 100,
        Math.round(sumTotal * 100) / 100,
      ])
      rows.push([
        'Moyenne',
        nEmp ? Math.round((sumJours / nEmp) * 100) / 100 : 0,
        nEmp ? Math.round((sumMatin / nEmp) * 100) / 100 : 0,
        nEmp ? Math.round((sumAprem / nEmp) * 100) / 100 : 0,
        nEmp ? Math.round((sumTotal / nEmp) * 100) / 100 : 0,
      ])
    }

    const detail: (string | number)[][] = []
    detail.push([`Détail par jour – ${periodStr}`])
    detail.push([])
    const head = ['Date', 'Jour', ...employeesExport.map((e) => e.name)]
    detail.push(head)

    for (const d of consultPeriodDays) {
      const wd = getDayOfWeek(d)
      const line: (string | number)[] = [formatDate(d), `${DAYS_FR[wd]} ${d.getDate()}`]
      for (const emp of employeesExport) {
        const shiftM = shiftById[getShiftIdForDate(emp.id, d, 'MATIN', data.patternCells, data.overrides, cycleStart, reposShift.id)]
        const shiftA = shiftById[getShiftIdForDate(emp.id, d, 'APREM', data.patternCells, data.overrides, cycleStart, reposShift.id)]
        const m = shiftM?.isRepos ? '—' : (shiftM?.shortCode ?? '—')
        const a = shiftA?.isRepos ? '—' : (shiftA?.shortCode ?? '—')
        line.push(`${m}/${a}`)
      }
      detail.push(line)
    }

    const wb = XLSX.utils.book_new()
    const ws1 = XLSX.utils.aoa_to_sheet(rows)
    ws1['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 12 }]
    XLSX.utils.book_append_sheet(wb, ws1, 'Récapitulatif')
    const ws2 = XLSX.utils.aoa_to_sheet(detail)
    const wch = [{ wch: 12 }, { wch: 10 }, ...employeesExport.map(() => ({ wch: 14 }))]
    ws2['!cols'] = wch
    XLSX.utils.book_append_sheet(wb, ws2, 'Détail par jour')
    const safePeriod = `${formatDate(consultRange.start)}_${formatDate(consultRange.end)}`.replace(/:/g, '-')
    const safeName =
      allMode || !employeesExport[0]
        ? ''
        : `_${employeesExport[0].name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_')}`
    const fileBase = allMode ? `recap_heures_${safePeriod}` : `recap${safeName}_${safePeriod}`
    XLSX.writeFile(wb, `${fileBase}.xlsx`)
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex gap-2 flex-wrap items-center rounded-2xl border border-slate-200/90 bg-gradient-to-r from-slate-50 via-white to-blue-50/60 p-2 shadow-sm">
        {((isAdmin ?? false)
          ? (['calendar', 'week', 'consult', 'pattern', 'employees', 'shifts'] as Tab[])
          : (['calendar', 'week', 'consult'] as Tab[])
        ).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3.5 py-2 rounded-xl text-sm font-semibold tracking-wide transition-all ${
              tab === t
                ? 'bg-blue-700 text-white shadow-md border border-blue-800'
                : 'bg-blue-100 text-blue-900 border border-blue-300 shadow-sm hover:bg-gradient-to-b hover:from-blue-800 hover:to-blue-900 hover:text-white hover:border-blue-900'
            }`}
          >
            {t === 'calendar' ? 'Calendrier' : t === 'week' ? 'Vue / imprimable' : t === 'consult' ? 'Consulter' : t === 'pattern' ? 'Roulement 2 semaines' : t === 'employees' ? 'Employés' : 'Créneaux'}
          </button>
        ))}
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="ml-auto px-3.5 py-2 bg-slate-900 text-white rounded-xl text-sm font-semibold shadow-sm hover:bg-slate-800 transition-colors"
        >
          Se deconnecter
        </button>
      </div>

      {tab === 'calendar' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-gradient-to-r from-white to-slate-50 px-3 py-2 shadow-sm">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 mr-1">Employé</span>
            <button
              type="button"
              onClick={() => setCalendarEmployeeFocus('all')}
              className={`h-10 min-w-[110px] px-3 rounded-xl border text-sm font-semibold transition-all ${
                calendarEmployeeFocus === 'all'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 border-blue-600 text-white shadow-md'
                  : 'bg-white border-slate-300 text-slate-700 hover:border-blue-200 hover:bg-blue-50/70'
              }`}
            >
              Tous
            </button>
            {orderedEmployees.map((e) => (
              (() => {
                const [r, g, b] = hexToRgb(e.color)
                const inactiveBg = `rgba(${r}, ${g}, ${b}, 0.16)`
                return (
              <button
                key={e.id}
                type="button"
                onClick={() => setCalendarEmployeeFocus(e.id)}
                className={`h-10 min-w-[110px] px-3 rounded-xl border text-sm font-semibold transition-all ${
                  calendarEmployeeFocus === e.id
                    ? 'text-white border-transparent shadow-md'
                    : 'border-transparent text-slate-800 shadow-sm hover:shadow-md'
                }`}
                style={calendarEmployeeFocus === e.id ? { backgroundColor: e.color } : { backgroundColor: inactiveBg }}
                title={`Afficher la colonne de ${e.name}`}
              >
                <span>{e.name}</span>
                {sessionEmployeeId === e.id ? ' *' : ''}
              </button>
                )
              })()
            ))}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white/90 px-3 py-3 shadow-sm space-y-2">
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => (month === 0 ? (setYear((y) => y - 1), setMonth(11)) : setMonth((m) => m - 1))} className="px-3 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50">←</button>
              <div className="text-2xl md:text-3xl font-bold text-slate-800 tracking-wide min-w-[240px] text-center">
                {MONTHS_FR[month]} {year}
              </div>
              <button onClick={() => (month === 11 ? (setYear((y) => y + 1), setMonth(0)) : setMonth((m) => m + 1))} className="px-3 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50">→</button>
            </div>
            <div className="flex items-center justify-end gap-2 flex-wrap">
              <button type="button" onClick={() => exportVueSemainePdf('calendar')} className="px-3 py-2 bg-rose-700 text-white rounded-lg text-sm font-semibold shadow-sm hover:bg-rose-800">📄 Exporter PDF</button>
              <button type="button" onClick={exportCsv} className="px-3 py-2 border border-emerald-600 text-emerald-700 rounded-lg text-sm hover:bg-emerald-50" title="Export avancé (technique)">CSV (advanced)</button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-auto table-fixed text-sm" style={{ minWidth: calendarTableMinWidth }}>
              <thead>
                <tr className="bg-slate-100/90">
                  <th className="w-[112px] p-2 text-left border-b border-r border-slate-200">Jour</th>
                  {calendarEmployees.map((e) => (
                    <th
                      key={e.id}
                      className={`w-[160px] p-2 select-none border-b border-r last:border-r-0 border-slate-200 ${
                        calendarEmployeeFocus === e.id ? 'bg-blue-100/80 text-blue-800' : ''
                      }`}
                    >
                      {e.name}
                      {sessionEmployeeId === e.id ? ' (vous)' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((d) => {
                  const wd = getDayOfWeek(d)
                  const dKey = formatDate(d)
                  const holidayName = holidayMap[dKey]
                  const isSaturday = wd === 5
                  const isSunday = wd === 6
                  const isHoliday = Boolean(holidayName)
                  const rowClass = isHoliday
                    ? 'bg-amber-100/85 border-l-4 border-amber-500'
                    : isSunday
                      ? 'bg-rose-100/75 border-l-4 border-rose-400'
                      : isSaturday
                        ? 'bg-violet-100/75 border-l-4 border-violet-400'
                        : ''
                  return (
                    <tr key={d.toISOString()} className={rowClass}>
                      <td className="w-[112px] p-2 whitespace-nowrap border-b border-r border-slate-200 align-top">
                        <span className="inline-flex flex-wrap items-center gap-1.5 align-middle">
                          {(isHoliday || isSaturday || isSunday) && (
                            <span
                              className={`inline-block h-2 w-6 rounded-full ${
                                isHoliday ? 'bg-amber-500' : isSunday ? 'bg-rose-400' : 'bg-violet-500'
                              }`}
                              title={isHoliday ? 'Jour ferié' : isSunday ? 'Dimanche' : 'Samedi'}
                            />
                          )}
                          <span>
                            {DAYS_FR[wd]} {d.getDate()}
                          </span>
                          {holidayName && (
                            <span
                              className="inline-block max-w-[140px] truncate text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 align-middle"
                              title={holidayName}
                            >
                              {holidayName}
                            </span>
                          )}
                        </span>
                      </td>
                      {calendarEmployees.map((e) => {
                        const ds = formatDate(d)
                        const shiftM = shiftById[getShiftIdForDate(e.id, d, 'MATIN', data.patternCells, data.overrides, cycleStart, reposShift.id)]
                        const shiftA = shiftById[getShiftIdForDate(e.id, d, 'APREM', data.patternCells, data.overrides, cycleStart, reposShift.id)]
                        const hasOverride = data.overrides.some((o) => formatDate(new Date(o.date)) === ds && o.employeeId === e.id)
                        return (
                          <td key={e.id} className="w-[160px] p-2 relative align-top border-b border-r last:border-r-0 border-slate-200">
                            <div className="flex flex-col gap-0 items-stretch rounded-md overflow-hidden border border-slate-200/80">
                              <button
                                type="button"
                                title="Matin"
                                onMouseDown={(ev) => {
                                  ev.stopPropagation()
                                  const rect = ev.currentTarget.getBoundingClientRect()
                                  const spaceBelow = window.innerHeight - rect.bottom
                                  const openUpward = spaceBelow < 280
                                  window.setTimeout(() => {
                                    setPicker({
                                      key: `${ds}-${e.id}-MATIN`,
                                      left: rect.left,
                                      top: openUpward ? undefined : rect.bottom + 6,
                                      bottom: openUpward ? window.innerHeight - rect.top + 6 : undefined,
                                      openUpward,
                                      date: ds,
                                      employeeId: e.id,
                                      slot: 'MATIN',
                                    })
                                  }, 0)
                                }}
                                className="px-1.5 py-0.5 text-[10px] font-semibold border-b border-slate-200/80"
                                style={{ backgroundColor: shiftM?.bgColor, color: shiftM?.fgColor }}
                              >
                                <span className="opacity-70 mr-0.5">M</span>
                                {shiftM?.shortCode}
                              </button>
                              <button
                                type="button"
                                title="Après-midi"
                                onMouseDown={(ev) => {
                                  ev.stopPropagation()
                                  const rect = ev.currentTarget.getBoundingClientRect()
                                  const spaceBelow = window.innerHeight - rect.bottom
                                  const openUpward = spaceBelow < 280
                                  window.setTimeout(() => {
                                    setPicker({
                                      key: `${ds}-${e.id}-APREM`,
                                      left: rect.left,
                                      top: openUpward ? undefined : rect.bottom + 6,
                                      bottom: openUpward ? window.innerHeight - rect.top + 6 : undefined,
                                      openUpward,
                                      date: ds,
                                      employeeId: e.id,
                                      slot: 'APREM',
                                    })
                                  }, 0)
                                }}
                                className="px-1.5 py-0.5 text-[10px] font-semibold"
                                style={{ backgroundColor: shiftA?.bgColor, color: shiftA?.fgColor }}
                              >
                                <span className="opacity-70 mr-0.5">A</span>
                                {shiftA?.shortCode}
                              </button>
                            </div>
                            {hasOverride && <span className="absolute right-1 top-0.5 w-2 h-2 bg-red-600 rounded-full" />}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50">
                  <td className="p-2 font-medium">Total heures</td>
                  {calendarEmployees.map((e) => {
                    const total = days.reduce((acc, d) => {
                      const sidM = getShiftIdForDate(e.id, d, 'MATIN', data.patternCells, data.overrides, cycleStart, reposShift.id)
                      const sidA = getShiftIdForDate(e.id, d, 'APREM', data.patternCells, data.overrides, cycleStart, reposShift.id)
                      return acc + shiftHours(shiftById[sidM]) + shiftHours(shiftById[sidA])
                    }, 0)
                    return <td key={e.id} className="p-2 font-medium">{total.toFixed(2)}h</td>
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {tab === 'week' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-500 mr-1">Vue</span>
            {(['day', 'week', 'month', 'calendar'] as WeekViewMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setWeekViewMode(m)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                  weekViewMode === m
                    ? 'bg-blue-800 text-white border border-blue-900 shadow-sm'
                    : 'bg-blue-100 text-blue-900 border border-blue-300 shadow-sm hover:bg-blue-200'
                }`}
              >
                {m === 'day' ? 'Jour' : m === 'week' ? 'Semaine' : m === 'month' ? 'Mois' : 'Calendrier'}
              </button>
            ))}
          </div>

          {weekViewMode === 'day' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 w-full">
                <button
                  type="button"
                  className="px-2 py-1 border rounded"
                  onClick={() => {
                    const d = new Date(dayViewDate)
                    d.setDate(d.getDate() - 1)
                    setDayViewDate(d)
                  }}
                >
                  ←
                </button>
                <input
                  type="date"
                  value={formatDate(dayViewDate)}
                  onChange={(e) => {
                    setDayViewDate(parseLocalDate(e.target.value))
                  }}
                  className="border border-gray-200 rounded px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  className="px-2 py-1 border rounded"
                  onClick={() => {
                    const d = new Date(dayViewDate)
                    d.setDate(d.getDate() + 1)
                    setDayViewDate(d)
                  }}
                >
                  →
                </button>
                <button type="button" onClick={() => exportVueSemainePdf('day')} className="ml-auto px-3 py-2 bg-rose-700 text-white rounded-lg text-sm">
                  📄 Exporter PDF
                </button>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">{formatDayTitleFr(dayViewDate)}</h2>
              {holidayMap[formatDate(dayViewDate)] && (
                <div className="max-w-2xl mx-auto w-full rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-800">
                  {holidayMap[formatDate(dayViewDate)]}
                </div>
              )}
              <div className="max-w-2xl w-full mx-auto">
                {(() => {
                  const dayDate = new Date(dayViewDate)
                  dayDate.setHours(0, 0, 0, 0)
                  const wd = getDayOfWeek(dayDate)
                  const todayStr = formatDate(new Date())
                  const isToday = formatDate(dayDate) === todayStr
                  const dayAbbr = DAYS_FR[wd].slice(0, 3)
                  const rows = data.employees.map((emp) => {
                    const sidM = getShiftIdForDate(emp.id, dayDate, 'MATIN', data.patternCells, data.overrides, cycleStart, reposShift.id)
                    const sidA = getShiftIdForDate(emp.id, dayDate, 'APREM', data.patternCells, data.overrides, cycleStart, reposShift.id)
                    const shM = shiftById[sidM]
                    const shA = shiftById[sidA]
                    return { emp, shM, shA }
                  })
                  const reposOnly = rows.filter((r) => r.shM?.isRepos && r.shA?.isRepos)
                  const matinRows = rows.filter((r) => coversWeekMatin(r.shM))
                  const apresRows = rows.filter((r) => coversWeekApresMidi(r.shA))
                  const matinCount = matinRows.length
                  const apresCount = apresRows.length
                  const dayHoliday = holidayMap[formatDate(dayDate)]
                  const isSundayClosed = wd === 6 && matinCount === 0 && apresCount === 0
                  const isSaturdayAfternoonClosed = wd === 5
                  const specialStripeClass = dayHoliday
                    ? 'bg-amber-100/85'
                    : wd === 6
                      ? 'bg-rose-100/75'
                      : wd === 5
                        ? 'bg-violet-100/75'
                        : ''
                  const specialDayFrameClass = dayHoliday
                    ? 'bg-amber-100/50 border-l-4 border-amber-500'
                    : wd === 6
                      ? 'bg-rose-100/45 border-l-4 border-rose-400'
                      : wd === 5
                        ? 'bg-violet-100/45 border-l-4 border-violet-400'
                        : ''
                  const renderChip = (emp: Employee, sh: Shift | undefined) => (
                    <div
                      key={emp.id}
                      className="rounded-md px-1.5 py-1 shadow-sm"
                      style={{ backgroundColor: sh?.bgColor ?? '#eee', color: sh?.fgColor ?? '#333' }}
                    >
                      <div className="font-medium leading-tight" style={{ fontSize: '11px' }}>
                        {emp.name}
                      </div>
                      <div className="opacity-75 leading-tight" style={{ fontSize: '10px' }}>
                        {sh?.label}
                      </div>
                    </div>
                  )
                  return (
                    <div className={`flex flex-col rounded-lg border border-gray-200 shadow-sm overflow-hidden min-h-[380px] ${specialDayFrameClass || 'bg-white'}`}>
                      <div
                        className={`text-center py-2 px-1 border-b border-gray-100 ${
                          isToday
                            ? 'bg-blue-100'
                            : specialStripeClass || 'bg-gray-50'
                        } ${wd === 6 ? 'text-red-600' : wd === 5 ? 'text-purple-600' : 'text-gray-900'}`}
                      >
                        <div className="text-xs font-semibold uppercase tracking-wide">{dayAbbr}</div>
                        <div className="text-base font-bold leading-tight">{dayDate.getDate()}</div>
                      </div>
                      <div className="flex-1 flex flex-col min-h-[260px] bg-white">
                        {isSundayClosed && (
                          <div className="flex-1 flex items-center justify-center text-xs text-gray-400 font-medium px-2">Fermé</div>
                        )}
                        {!isSundayClosed && (
                          <>
                            <div className={`flex-1 flex flex-col px-2 pt-2 pb-1.5 min-h-[120px] ${specialStripeClass || 'bg-amber-50/70'}`}>
                              <div className="text-[10px] font-medium text-amber-900/70 mb-1.5">Matin 8h30–12h15</div>
                              <div className="flex flex-col gap-1.5">
                                {matinRows.map(({ emp, shM }) => renderChip(emp, shM))}
                              </div>
                            </div>
                            <div className="h-px bg-gray-200/90 shrink-0" />
                            <div className={`flex-1 flex flex-col px-2 pt-2 pb-1.5 min-h-[120px] ${specialStripeClass || 'bg-sky-50/70'}`}>
                              <div className="text-[10px] font-medium text-sky-900/70 mb-1.5">14h00–19h15</div>
                              {isSaturdayAfternoonClosed ? (
                                <div className="flex-1 flex items-center justify-center text-xs text-gray-400 font-medium">Fermé</div>
                              ) : (
                                <div className="flex flex-col gap-1.5">
                                  {apresRows.map(({ emp, shA }) => renderChip(emp, shA))}
                                </div>
                              )}
                            </div>
                            {reposOnly.length > 0 && (
                              <div className="px-2 py-1.5 border-t border-gray-100 bg-gray-50/40 space-y-0.5">
                                {reposOnly.map(({ emp }) => (
                                  <div key={emp.id} className="text-[10px] text-gray-300 truncate">
                                    {emp.name}
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      <div className="px-2 py-1.5 border-t border-gray-100 text-center">
                        <span className="text-[11px] text-gray-500">
                          {matinCount} matin · {apresCount} ap-m
                        </span>
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>
          )}

          {weekViewMode === 'week' && (
            <>
              <div className="flex items-center gap-2 flex-wrap w-full">
                <button
                  type="button"
                  className="px-2 py-1 border rounded"
                  onClick={() => {
                    const d = new Date(weekStart)
                    d.setDate(d.getDate() - 7)
                    setWeekStart(d)
                  }}
                >
                  ←
                </button>
                <div className="font-semibold text-sm">{formatWeekRangeFr(weekStart)}</div>
                <button
                  type="button"
                  className="px-2 py-1 border rounded"
                  onClick={() => {
                    const d = new Date(weekStart)
                    d.setDate(d.getDate() + 7)
                    setWeekStart(d)
                  }}
                >
                  →
                </button>
                <button type="button" onClick={() => exportVueSemainePdf('week')} className="ml-auto px-3 py-2 bg-rose-700 text-white rounded-lg text-sm">
                  📄 Exporter PDF
                </button>
              </div>
              <div className="overflow-x-auto pb-1">
                <div className="grid grid-cols-7 gap-2 min-w-[720px]">
                  {Array.from({ length: 7 }, (_, i) => {
                    const dayDate = new Date(weekStart)
                    dayDate.setDate(weekStart.getDate() + i)
                    dayDate.setHours(0, 0, 0, 0)
                    const wd = getDayOfWeek(dayDate)
                    const todayStr = formatDate(new Date())
                    const isToday = formatDate(dayDate) === todayStr
                    const dayAbbr = DAYS_FR[wd].slice(0, 3)
                    const weekDayKey = formatDate(dayDate)
                    const weekHoliday = holidayMap[weekDayKey]

                    const rows = data.employees.map((emp) => {
                      const sidM = getShiftIdForDate(emp.id, dayDate, 'MATIN', data.patternCells, data.overrides, cycleStart, reposShift.id)
                      const sidA = getShiftIdForDate(emp.id, dayDate, 'APREM', data.patternCells, data.overrides, cycleStart, reposShift.id)
                      const shM = shiftById[sidM]
                      const shA = shiftById[sidA]
                      return { emp, shM, shA }
                    })
                    const reposOnly = rows.filter((r) => r.shM?.isRepos && r.shA?.isRepos)
                    const matinRows = rows.filter((r) => coversWeekMatin(r.shM))
                    const apresRows = rows.filter((r) => coversWeekApresMidi(r.shA))
                    const matinCount = matinRows.length
                    const apresCount = apresRows.length
                    const isSundayClosed = wd === 6 && matinCount === 0 && apresCount === 0
                    const isSaturdayAfternoonClosed = wd === 5
                    const specialStripeClass = weekHoliday
                      ? 'bg-amber-100/85'
                      : wd === 6
                        ? 'bg-rose-100/75'
                        : wd === 5
                          ? 'bg-violet-100/75'
                          : ''
                    const specialDayFrameClass = weekHoliday
                      ? 'bg-amber-100/50 border-l-4 border-amber-500'
                      : wd === 6
                        ? 'bg-rose-100/45 border-l-4 border-rose-400'
                        : wd === 5
                          ? 'bg-violet-100/45 border-l-4 border-violet-400'
                          : ''

                    const renderChip = (emp: Employee, sh: Shift | undefined) => (
                      <div
                        key={emp.id}
                        className="rounded-md px-1.5 py-1 shadow-sm"
                        style={{ backgroundColor: sh?.bgColor ?? '#eee', color: sh?.fgColor ?? '#333' }}
                      >
                        <div className="font-medium leading-tight" style={{ fontSize: '11px' }}>
                          {emp.name}
                        </div>
                        <div className="opacity-75 leading-tight" style={{ fontSize: '10px' }}>
                          {sh?.label}
                        </div>
                      </div>
                    )

                    return (
                      <div
                        key={i}
                        className={`flex flex-col rounded-lg border border-gray-200 shadow-sm overflow-hidden min-h-[380px] ${specialDayFrameClass || 'bg-white'}`}
                      >
                        <div
                          className={`text-center py-2 px-1 border-b border-gray-100 ${
                            isToday
                              ? 'bg-blue-100'
                              : specialStripeClass || 'bg-gray-50'
                          } ${wd === 6 ? 'text-red-600' : wd === 5 ? 'text-purple-600' : 'text-gray-900'}`}
                        >
                          <div className="text-xs font-semibold uppercase tracking-wide">{dayAbbr}</div>
                          <div className="text-base font-bold leading-tight">{dayDate.getDate()}</div>
                          {weekHoliday && (
                            <div
                              className="text-[9px] font-semibold text-red-700 mt-0.5 px-0.5 leading-tight text-center"
                              title={weekHoliday}
                            >
                              {truncateHolidayLabel(weekHoliday)}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 flex flex-col min-h-[260px] bg-white">
                          {isSundayClosed && (
                            <div className="flex-1 flex items-center justify-center text-xs text-gray-400 font-medium px-2">Fermé</div>
                          )}
                          {!isSundayClosed && (
                            <>
                              <div className={`flex-1 flex flex-col px-2 pt-2 pb-1.5 min-h-[120px] ${specialStripeClass || 'bg-amber-50/70'}`}>
                                <div className="text-[10px] font-medium text-amber-900/70 mb-1.5">Matin 8h30–12h15</div>
                                <div className="flex flex-col gap-1.5">
                                  {matinRows.map(({ emp, shM }) => renderChip(emp, shM))}
                                </div>
                              </div>
                              <div className="h-px bg-gray-200/90 shrink-0" />
                              <div className={`flex-1 flex flex-col px-2 pt-2 pb-1.5 min-h-[120px] ${specialStripeClass || 'bg-sky-50/70'}`}>
                                <div className="text-[10px] font-medium text-sky-900/70 mb-1.5">14h00–19h15</div>
                                {isSaturdayAfternoonClosed ? (
                                  <div className="flex-1 flex items-center justify-center text-xs text-gray-400 font-medium">Fermé</div>
                                ) : (
                                  <div className="flex flex-col gap-1.5">
                                    {apresRows.map(({ emp, shA }) => renderChip(emp, shA))}
                                  </div>
                                )}
                              </div>
                              {reposOnly.length > 0 && (
                                <div className="px-2 py-1.5 border-t border-gray-100 bg-gray-50/40 space-y-0.5">
                                  {reposOnly.map(({ emp }) => (
                                    <div key={emp.id} className="text-[10px] text-gray-300 truncate">
                                      {emp.name}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        <div className="px-2 py-1.5 border-t border-gray-100 text-center">
                          <span className="text-[11px] text-gray-500">
                            {matinCount} matin · {apresCount} ap-m
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          {weekViewMode === 'month' && (
            <div className="space-y-2 relative">
              <div className="flex items-center gap-2 flex-wrap w-full">
                <button
                  type="button"
                  className="px-2 py-1 border rounded"
                  onClick={() => {
                    if (monthViewMonth === 0) {
                      setMonthViewMonth(11)
                      setMonthViewYear((y) => y - 1)
                    } else {
                      setMonthViewMonth((m) => m - 1)
                    }
                  }}
                >
                  ←
                </button>
                <div className="font-semibold text-sm capitalize">
                  {MONTHS_FR[monthViewMonth]} {monthViewYear}
                </div>
                <button
                  type="button"
                  className="px-2 py-1 border rounded"
                  onClick={() => {
                    if (monthViewMonth === 11) {
                      setMonthViewMonth(0)
                      setMonthViewYear((y) => y + 1)
                    } else {
                      setMonthViewMonth((m) => m + 1)
                    }
                  }}
                >
                  →
                </button>
                <button type="button" onClick={() => exportVueSemainePdf('month')} className="ml-auto px-3 py-2 bg-rose-700 text-white rounded-lg text-sm">
                  📄 Exporter PDF
                </button>
              </div>
              <div className="max-h-[min(72vh,880px)] overflow-y-auto overflow-x-auto pr-1">
                {monthViewWeeks.map((weekDays) => {
                  const weekStart = new Date(weekDays[0])
                  weekStart.setHours(0, 0, 0, 0)
                  return (
                    <div key={weekStart.toISOString()} className="mb-4 last:mb-0">
                      <div className="rounded-md bg-gray-100/90 px-3 py-2 text-center text-xs font-medium text-gray-700 border border-gray-200/80">
                        {formatWeekRangeFr(weekStart)}
                      </div>
                      <div className="grid grid-cols-7 gap-2 min-w-[720px] mt-2">
                        {weekDays.map((cellDate) => {
                          const dayDate = new Date(cellDate)
                          dayDate.setHours(0, 0, 0, 0)
                          const wd = getDayOfWeek(dayDate)
                          const dayAbbr = DAYS_FR[wd].slice(0, 3)
                          const inMonth = dayDate.getMonth() === monthViewMonth && dayDate.getFullYear() === monthViewYear
                          const todayStr = formatDate(new Date())
                          const isToday = formatDate(dayDate) === todayStr
                          const cellKey = formatDate(dayDate)
                          const cellHoliday = holidayMap[cellKey]
                          const rows = data.employees.map((emp) => {
                            const sidM = getShiftIdForDate(emp.id, dayDate, 'MATIN', data.patternCells, data.overrides, cycleStart, reposShift.id)
                            const sidA = getShiftIdForDate(emp.id, dayDate, 'APREM', data.patternCells, data.overrides, cycleStart, reposShift.id)
                            const shM = shiftById[sidM]
                            const shA = shiftById[sidA]
                            return { emp, shM, shA }
                          })
                          const matinRows = rows.filter((r) => coversWeekMatin(r.shM))
                          const apresRows = rows.filter((r) => coversWeekApresMidi(r.shA))
                          const matinCount = matinRows.length
                          const apresCount = apresRows.length
                          const isSundayClosed = wd === 6 && matinCount === 0 && apresCount === 0
                          const isSaturdayAfternoonClosed = wd === 5
                          const specialStripeClass = inMonth
                            ? cellHoliday
                              ? 'bg-amber-100/85'
                              : wd === 6
                                ? 'bg-rose-100/75'
                                : wd === 5
                                  ? 'bg-violet-100/75'
                                  : ''
                            : ''
                          const specialDayFrameClass = inMonth
                            ? cellHoliday
                              ? 'bg-amber-100/50 border-l-4 border-amber-500'
                              : wd === 6
                                ? 'bg-rose-100/45 border-l-4 border-rose-400'
                                : wd === 5
                                  ? 'bg-violet-100/45 border-l-4 border-violet-400'
                                  : ''
                            : ''
                          const monthChip = (emp: Employee, sh: Shift | undefined) => (
                            <div
                              key={emp.id}
                              className="rounded-md px-1.5 py-1 shadow-sm"
                              style={{ backgroundColor: sh?.bgColor ?? '#eee', color: sh?.fgColor ?? '#333' }}
                            >
                              <div className="font-medium leading-tight" style={{ fontSize: '11px' }}>
                                {emp.name}
                              </div>
                              <div className="opacity-75 leading-tight" style={{ fontSize: '10px' }}>
                                {sh?.shortCode}
                              </div>
                            </div>
                          )
                          return (
                            <div
                              key={cellKey}
                              className={`flex flex-col rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden min-h-[200px] ${
                                isToday ? 'ring-2 ring-blue-500 ring-offset-1' : ''
                              } ${cellHoliday ? 'border-red-100' : ''} ${specialDayFrameClass}`}
                            >
                              <div
                                className={`text-center py-2 px-1 border-b shrink-0 ${
                                  inMonth
                                    ? cellHoliday
                                      ? 'bg-red-50/80 border-red-100'
                                      : isToday
                                        ? 'bg-blue-100'
                                        : 'bg-gray-50'
                                    : 'bg-gray-100/70 text-gray-400'
                                } ${inMonth && wd === 6 ? 'text-red-600' : ''} ${inMonth && wd === 5 ? 'text-purple-600' : ''}`}
                              >
                                <div className={`text-xs font-semibold uppercase tracking-wide ${!inMonth ? 'text-gray-400' : ''}`}>{dayAbbr}</div>
                                <div className={`text-base font-bold leading-tight ${!inMonth ? 'text-gray-400' : ''}`}>{dayDate.getDate()}</div>
                                {cellHoliday && inMonth && (
                                  <div className="text-[9px] font-semibold text-red-700 mt-0.5 px-0.5 leading-tight text-center">
                                    {truncateHolidayLabel(cellHoliday)}
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 flex flex-col min-h-[140px] bg-white">
                                {isSundayClosed && (
                                  <div className="flex-1 flex items-center justify-center text-xs text-gray-400 font-medium px-2">Fermé</div>
                                )}
                                {!isSundayClosed && (
                                  <>
                                    <div className={`flex-1 flex flex-col px-2 pt-2 pb-1.5 min-h-[56px] ${specialStripeClass || 'bg-amber-50/70'}`}>
                                      <div className="text-[10px] font-medium text-amber-900/70 mb-1.5">Matin</div>
                                      <div className="flex flex-col gap-1.5">{matinRows.map(({ emp, shM }) => monthChip(emp, shM))}</div>
                                    </div>
                                    <div className="h-px bg-gray-200 shrink-0" />
                                    <div className={`flex-1 flex flex-col px-2 pt-2 pb-1.5 min-h-[56px] ${specialStripeClass || 'bg-sky-50/70'}`}>
                                      <div className="text-[10px] font-medium text-sky-900/70 mb-1.5">14h–19h</div>
                                      {isSaturdayAfternoonClosed ? (
                                        <div className="flex-1 flex items-center justify-center text-xs text-gray-400 font-medium">Fermé</div>
                                      ) : (
                                        <div className="flex flex-col gap-1.5">{apresRows.map(({ emp, shA }) => monthChip(emp, shA))}</div>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {weekViewMode === 'calendar' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => (month === 0 ? (setYear((y) => y - 1), setMonth(11)) : setMonth((m) => m - 1))} className="px-2 py-1 border rounded">←</button>
                <div className="font-semibold">{MONTHS_FR[month]} {year}</div>
                <button onClick={() => (month === 11 ? (setYear((y) => y + 1), setMonth(0)) : setMonth((m) => m + 1))} className="px-2 py-1 border rounded">→</button>
                <button type="button" onClick={() => exportVueSemainePdf('calendar')} className="ml-auto px-3 py-2 bg-rose-700 text-white rounded-lg text-sm">
                  📄 Exporter PDF
                </button>
              </div>
              <div className="overflow-x-auto border rounded-lg">
                <table className="w-auto text-sm" style={{ minWidth: calendarTableMinWidth }}>
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="p-2 text-left">Jour</th>
                      {calendarEmployees.map((e) => <th key={e.id} className="p-2">{e.name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => {
                      const wd = getDayOfWeek(d)
                      const dKey = formatDate(d)
                      const holidayName = holidayMap[dKey]
                      const isSaturday = wd === 5
                      const isSunday = wd === 6
                      const isHoliday = Boolean(holidayName)
                      const rowClass = isHoliday
                        ? 'bg-amber-100/85 border-l-4 border-amber-500'
                        : isSunday
                          ? 'bg-rose-100/75 border-l-4 border-rose-400'
                          : isSaturday
                            ? 'bg-violet-100/75 border-l-4 border-violet-400'
                            : ''
                      return (
                        <tr key={d.toISOString()} className={rowClass}>
                          <td className="p-2 whitespace-nowrap">
                            <span className="inline-flex flex-wrap items-center gap-1.5 align-middle">
                              <span>{DAYS_FR[wd]} {d.getDate()}</span>
                              {holidayName && (
                                <span className="inline-block max-w-[140px] truncate text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 align-middle" title={holidayName}>
                                  {holidayName}
                                </span>
                              )}
                            </span>
                          </td>
                          {calendarEmployees.map((e) => {
                            const shiftM = shiftById[getShiftIdForDate(e.id, d, 'MATIN', data.patternCells, data.overrides, cycleStart, reposShift.id)]
                            const shiftA = shiftById[getShiftIdForDate(e.id, d, 'APREM', data.patternCells, data.overrides, cycleStart, reposShift.id)]
                            return (
                              <td key={e.id} className="p-2 align-top">
                                <div className="flex flex-col gap-1 items-stretch">
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold border border-amber-200/80" style={{ backgroundColor: shiftM?.bgColor, color: shiftM?.fgColor }}>
                                    <span className="opacity-70 mr-0.5">M</span>
                                    {shiftM?.shortCode}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold border border-sky-200/80" style={{ backgroundColor: shiftA?.bgColor, color: shiftA?.fgColor }}>
                                    <span className="opacity-70 mr-0.5">A</span>
                                    {shiftA?.shortCode}
                                  </span>
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'consult' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 gap-y-2">
            <span className="text-sm font-medium text-gray-700 mr-1">Période</span>
            <button
              type="button"
              onClick={() => setConsultMode('week')}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                consultMode === 'week'
                  ? 'bg-blue-800 text-white border border-blue-900 shadow-sm'
                  : 'bg-blue-100 text-blue-900 border border-blue-300 shadow-sm hover:bg-blue-200'
              }`}
            >
              Cette semaine
            </button>
            <button
              type="button"
              onClick={() => setConsultMode('month')}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                consultMode === 'month'
                  ? 'bg-blue-800 text-white border border-blue-900 shadow-sm'
                  : 'bg-blue-100 text-blue-900 border border-blue-300 shadow-sm hover:bg-blue-200'
              }`}
            >
              Ce mois
            </button>
            <button
              type="button"
              onClick={() => setConsultMode('custom')}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                consultMode === 'custom'
                  ? 'bg-blue-800 text-white border border-blue-900 shadow-sm'
                  : 'bg-blue-100 text-blue-900 border border-blue-300 shadow-sm hover:bg-blue-200'
              }`}
            >
              Période personnalisée
            </button>
            {consultMode === 'custom' && (
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <label className="flex items-center gap-1 text-sm text-gray-600">
                  du
                  <input
                    type="date"
                    value={consultCustomFrom}
                    onChange={(e) => setConsultCustomFrom(e.target.value)}
                    className="border border-gray-200 rounded px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex items-center gap-1 text-sm text-gray-600">
                  au
                  <input
                    type="date"
                    value={consultCustomTo}
                    onChange={(e) => setConsultCustomTo(e.target.value)}
                    className="border border-gray-200 rounded px-2 py-1 text-sm"
                  />
                </label>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" onClick={exportRecapHeures} className="px-3 py-2 bg-rose-700 text-white rounded-lg text-sm font-semibold shadow-sm hover:bg-rose-800">📊 Exporter Excel</button>
          </div>
          <p className="text-xs text-gray-500">
            Du {formatDate(consultRange.start)} au {formatDate(consultRange.end)} · {consultPeriodDays.length} jour{consultPeriodDays.length === 1 ? '' : 's'}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-700 w-full sm:w-auto">Employée</span>
            <button
              type="button"
              onClick={() => setConsultEmployeeFilter('all')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                consultEmployeeFilter === 'all'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
              }`}
            >
              Toutes
            </button>
            {orderedEmployees.map((emp) => {
              const selected = consultEmployeeFilter === emp.id
              const [r, g, b] = hexToRgb(emp.color)
              const inactiveBg = `rgba(${r}, ${g}, ${b}, 0.16)`
              return (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => setConsultEmployeeFilter(emp.id)}
                  className={`inline-flex items-center gap-1.5 min-w-[110px] px-3 py-1.5 rounded-full text-sm font-semibold border transition-all ${
                    selected
                      ? 'text-white border-transparent shadow-sm'
                      : 'text-slate-800 border-transparent shadow-sm hover:shadow-md'
                  }`}
                  style={selected ? { backgroundColor: emp.color } : { backgroundColor: inactiveBg }}
                >
                  {emp.name}
                </button>
              )
            })}
          </div>

          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="p-3 font-medium text-gray-700">Employée</th>
                  <th className="p-3 font-medium text-gray-700 min-w-[220px]">Total</th>
                  <th className="p-3 font-medium text-gray-700">Par type de créneau</th>
                  <th className="p-3 font-medium text-gray-700 text-right">Repos</th>
                </tr>
              </thead>
              <tbody>
                {consultFilteredStats.map((row) => {
                  const pct = (row.totalHours / consultFilteredMaxHours) * 100
                  const labelOrder = (lab: string) => data.shifts.find((s) => s.label === lab)?.order ?? 999
                  const breakdownParts = Object.entries(row.typeCounts)
                    .filter(([, n]) => n > 0)
                    .sort((a, b) => labelOrder(a[0]) - labelOrder(b[0]))
                  return (
                    <tr key={row.emp.id} className="border-t border-gray-100 align-middle">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: row.emp.color }}
                            aria-hidden
                          />
                          <span className="font-medium text-gray-900">{row.emp.name}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-[100px] h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-[width]"
                              style={{ width: `${pct}%`, backgroundColor: row.emp.color }}
                            />
                          </div>
                          <span className="tabular-nums text-gray-900 font-medium shrink-0 w-16 text-right">
                            {row.totalHours.toFixed(1)}h
                          </span>
                        </div>
                      </td>
                      <td className="p-3 text-xs text-gray-600 leading-relaxed">
                        {breakdownParts.length === 0 ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          breakdownParts.map(([label, n], i) => (
                            <span key={label}>
                              {i > 0 ? ' · ' : ''}
                              {label} {n} j
                            </span>
                          ))
                        )}
                      </td>
                      <td className="p-3 text-right tabular-nums text-gray-500 text-xs">{row.reposDays} j</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-8 text-sm text-gray-600 border-t border-gray-200 pt-4">
            {consultEmployeeFilter === 'all' ? (
              <>
                <span>
                  Total équipe :{' '}
                  <strong className="text-gray-900 tabular-nums">{consultTeamTotalHours.toFixed(1)} h</strong>
                </span>
                <span>
                  Moyenne par employée :{' '}
                  <strong className="text-gray-900 tabular-nums">{consultAvgHoursPerEmployee.toFixed(1)} h</strong>
                </span>
              </>
            ) : (
              consultFilteredStats[0] && (
                <>
                  <span>
                    Total :{' '}
                    <strong className="text-gray-900 tabular-nums">{consultFilteredStats[0].totalHours.toFixed(1)} h</strong>
                  </span>
                  <span>
                    Jours travaillés :{' '}
                    <strong className="text-gray-900 tabular-nums">
                      {consultPeriodDays.length - consultFilteredStats[0].reposDays}
                    </strong>
                    <span className="text-gray-500 font-normal"> / {consultPeriodDays.length} j</span>
                  </span>
                </>
              )
            )}
          </div>
        </div>
      )}

      {tab === 'pattern' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <label>Debut cycle (lundi)</label>
            <input type="date" defaultValue={formatDate(cycleStart)} className="border rounded px-2 py-1" onChange={async (e) => {
              const d = parseLocalDate(e.target.value)
              if (getDayOfWeek(d) !== 0) return alert('La date doit etre un lundi')
              const cycleConfig = await fetch('/api/schedule/cycle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startDate: d.toISOString() }) }).then((r) => r.json()) as CycleConfig
              setData({ ...data, cycleConfig })
            }} />
          </div>
          {[0, 7].map((offset) => (
            <div key={offset}>
              <h3 className="font-semibold mb-2">Semaine {offset === 0 ? 1 : 2}</h3>
              <div className="overflow-x-auto border rounded">
                <table className="min-w-[900px] w-full text-sm">
                  <thead><tr><th className="p-2 text-left">Employee</th>{DAYS_FR.map((d) => <th key={d} className="p-2">{d}</th>)}</tr></thead>
                  <tbody>
                    {data.employees.map((e) => (
                      <tr key={`${offset}-${e.id}`}>
                        <td className="p-2">{e.name}</td>
                        {Array.from({ length: 7 }).map((_, i) => {
                          const dayIndex = offset + i
                          const cellM = data.patternCells.find((p) => p.dayIndex === dayIndex && p.employeeId === e.id && p.slot === 'MATIN')
                          const cellA = data.patternCells.find((p) => p.dayIndex === dayIndex && p.employeeId === e.id && p.slot === 'APREM')
                          const shiftM = shiftById[cellM?.shiftId ?? reposShift.id]
                          const shiftA = shiftById[cellA?.shiftId ?? reposShift.id]
                          return (
                            <td key={i} className="p-2 align-top">
                              <div className="flex flex-col gap-1">
                                <button
                                  type="button"
                                  title="Matin"
                                  onMouseDown={(ev) => {
                                    ev.stopPropagation()
                                    const rect = ev.currentTarget.getBoundingClientRect()
                                    const spaceBelow = window.innerHeight - rect.bottom
                                    const openUpward = spaceBelow < 280
                                    window.setTimeout(() => {
                                      setPicker({
                                        key: `p-${dayIndex}-${e.id}-MATIN`,
                                        left: rect.left,
                                        top: openUpward ? undefined : rect.bottom + 6,
                                        bottom: openUpward ? window.innerHeight - rect.top + 6 : undefined,
                                        openUpward,
                                        dayIndex,
                                        employeeId: e.id,
                                        slot: 'MATIN',
                                      })
                                    }, 0)
                                  }}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 border border-amber-200/80"
                                  style={{ backgroundColor: shiftM?.bgColor, color: shiftM?.fgColor }}
                                >
                                  <span className="opacity-70 mr-0.5">M</span>
                                  {shiftM?.shortCode}
                                </button>
                                <button
                                  type="button"
                                  title="Après-midi"
                                  onMouseDown={(ev) => {
                                    ev.stopPropagation()
                                    const rect = ev.currentTarget.getBoundingClientRect()
                                    const spaceBelow = window.innerHeight - rect.bottom
                                    const openUpward = spaceBelow < 280
                                    window.setTimeout(() => {
                                      setPicker({
                                        key: `p-${dayIndex}-${e.id}-APREM`,
                                        left: rect.left,
                                        top: openUpward ? undefined : rect.bottom + 6,
                                        bottom: openUpward ? window.innerHeight - rect.top + 6 : undefined,
                                        openUpward,
                                        dayIndex,
                                        employeeId: e.id,
                                        slot: 'APREM',
                                      })
                                    }, 0)
                                  }}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-50 border border-sky-200/80"
                                  style={{ backgroundColor: shiftA?.bgColor, color: shiftA?.fgColor }}
                                >
                                  <span className="opacity-70 mr-0.5">A</span>
                                  {shiftA?.shortCode}
                                </button>
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'employees' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            La liste reprend tous les employes en base. Si un nom manque apres un changement dans la base, utilisez <strong>Rafraîchir</strong>. Pour le compte admin, l’employe lie doit exister ici — renommez la ligne ou ajoutez « Norman » sans reutiliser l’email admin dans le formulaire.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <input placeholder="Nom" className="border rounded px-2 py-1" value={newEmp.name} onChange={(e) => setNewEmp({ ...newEmp, name: e.target.value })} />
            <input type="color" className="h-9" value={newEmp.color} onChange={(e) => setNewEmp({ ...newEmp, color: e.target.value })} />
            <input placeholder="email (optionnel)" className="border rounded px-2 py-1" value={newEmp.email} onChange={(e) => setNewEmp({ ...newEmp, email: e.target.value })} />
            <input placeholder="code temporaire" className="border rounded px-2 py-1" value={newEmp.password} onChange={(e) => setNewEmp({ ...newEmp, password: e.target.value })} />
            <button type="button" className="px-3 py-2 bg-blue-600 text-white rounded" onClick={async () => {
              const r = await fetch('/api/admin/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newEmp) })
              const body = await r.json().catch(() => ({})) as { error?: string }
              if (!r.ok) {
                window.alert(typeof body.error === 'string' ? body.error : 'Erreur lors de l\'ajout')
                return
              }
              await reloadScheduleData()
              setNewEmp({ name: '', color: '#607d8b', email: '', password: '' })
            }}>Ajouter</button>
            <button type="button" className="px-3 py-2 border rounded text-sm" onClick={() => void reloadScheduleData()}>Rafraîchir</button>
          </div>
          {data.employees.map((e) => (
            <div key={e.id} className="border rounded-lg p-3 flex flex-wrap gap-3 items-end">
              <input className="border rounded px-2 py-1" defaultValue={e.name} onBlur={async (ev) => {
                const name = ev.target.value
                setData({ ...data, employees: data.employees.map((x) => x.id === e.id ? { ...x, name } : x) })
                await fetch('/api/admin/employees', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.id, name, color: e.color }) })
              }} />
              <input type="color" value={e.color} onChange={async (ev) => {
                const color = ev.target.value
                setData({ ...data, employees: data.employees.map((x) => x.id === e.id ? { ...x, color } : x) })
                await fetch('/api/admin/employees', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.id, name: e.name, color }) })
              }} />
              <input
                type="email"
                placeholder="email d'acces"
                className="border rounded px-2 py-1 min-w-[230px]"
                value={employeeAccessDrafts[e.id]?.email ?? ''}
                onChange={(ev) =>
                  setEmployeeAccessDrafts((prev) => ({
                    ...prev,
                    [e.id]: { email: ev.target.value, password: prev[e.id]?.password ?? '' },
                  }))
                }
              />
              <input
                type="password"
                placeholder="nouveau code"
                className="border rounded px-2 py-1 min-w-[190px]"
                value={employeeAccessDrafts[e.id]?.password ?? ''}
                onChange={(ev) =>
                  setEmployeeAccessDrafts((prev) => ({
                    ...prev,
                    [e.id]: { email: prev[e.id]?.email ?? e.user?.email ?? '', password: ev.target.value },
                  }))
                }
              />
              <button className="px-3 py-2 text-sm border rounded" onClick={async () => {
                const access = employeeAccessDrafts[e.id] ?? { email: e.user?.email ?? '', password: '' }
                const r = await fetch('/api/admin/employees', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    id: e.id,
                    name: e.name,
                    color: e.color,
                    email: access.email,
                    password: access.password,
                  }),
                })
                const body = await r.json().catch(() => ({})) as { error?: string }
                if (!r.ok) {
                  window.alert(typeof body.error === 'string' ? body.error : "Erreur de mise a jour de l'acces")
                  return
                }
                await reloadScheduleData()
                setEmployeeAccessDrafts((prev) => ({
                  ...prev,
                  [e.id]: { email: access.email, password: '' },
                }))
              }}>Enregistrer acces</button>
              <button className="ml-auto px-3 py-2 text-sm bg-red-600 text-white rounded" onClick={async () => {
                setData({ ...data, employees: data.employees.filter((x) => x.id !== e.id) })
                await fetch('/api/admin/employees', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.id }) })
              }}>Supprimer</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'shifts' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-end">
            <input
              placeholder="Nom du créneau (ex: Matin pharmacie)"
              className="border rounded px-2 py-1 min-w-[240px]"
              value={newShift.label || ''}
              onChange={(e) => setNewShift({ ...newShift, label: e.target.value })}
            />
            <input
              placeholder="Code court (optionnel, ex: MAT)"
              className="border rounded px-2 py-1 min-w-[210px]"
              value={newShift.shortCode || ''}
              onChange={(e) => setNewShift({ ...newShift, shortCode: e.target.value.toUpperCase() })}
            />
            <label className="flex flex-col gap-0.5 text-xs text-gray-600">
              <span>Début</span>
              <input type="time" className="border rounded px-2 py-1" value={newShiftTime.debut} onChange={(e) => setNewShiftTime((t) => ({ ...t, debut: e.target.value }))} />
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-gray-600">
              <span>Fin</span>
              <input type="time" className="border rounded px-2 py-1" value={newShiftTime.fin} onChange={(e) => setNewShiftTime((t) => ({ ...t, fin: e.target.value }))} />
            </label>
            <input type="color" className="h-9 w-10 border rounded" title="Fond" value={newShift.bgColor || '#eeeeee'} onChange={(e) => setNewShift({ ...newShift, bgColor: e.target.value })} />
            <input type="color" className="h-9 w-10 border rounded" title="Texte" value={newShift.fgColor || '#757575'} onChange={(e) => setNewShift({ ...newShift, fgColor: e.target.value })} />
            <button type="button" className="px-3 py-2 bg-blue-600 text-white rounded" onClick={async () => {
              const sd = parseTimeInput(newShiftTime.debut)
              const ed = parseTimeInput(newShiftTime.fin)
              if (!sd || !ed) {
                window.alert('Début et fin : horaires valides (HH:MM) requis')
                return
              }
              const payload = {
                label: newShift.label || '',
                shortCode: (newShift.shortCode || '').trim() || buildShiftShortCode(newShift.label || ''),
                startHour: sd.hour,
                startMin: sd.min,
                endHour: ed.hour,
                endMin: ed.min,
                bgColor: newShift.bgColor || '#eeeeee',
                fgColor: newShift.fgColor || '#757575',
                isRepos: false,
              }
              const r = await fetch('/api/admin/shifts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
              if (!r.ok) return
              const created = (await r.json()) as Shift
              setData({ ...data, shifts: [...data.shifts, created].sort((a, b) => a.order - b.order) })
              setNewShift({ label: '', shortCode: '', bgColor: '#eeeeee', fgColor: '#757575' })
              setNewShiftTime({ debut: '09:00', fin: '12:30' })
            }}>Ajouter créneau</button>
          </div>
          <div className="text-xs text-gray-500">
            Libellé = nom complet affiché dans le planning. Code = version courte affichée dans les cellules (si vide, générée automatiquement).
          </div>
          {data.shifts.map((s) => (
            <div key={s.id} className="border rounded-lg p-3 flex flex-wrap gap-2 items-end">
              <span className="px-2 py-1 rounded text-xs self-center" style={{ backgroundColor: s.bgColor, color: s.fgColor }}>{s.shortCode}</span>
              <input className="border rounded px-2 py-1 w-28 text-sm" defaultValue={s.shortCode} onBlur={async (ev) => {
                const shortCode = ev.target.value
                setData({ ...data, shifts: data.shifts.map((x) => x.id === s.id ? { ...x, shortCode } : x) })
                await fetch('/api/admin/shifts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id, shortCode }) })
              }} />
              <input className="border rounded px-2 py-1 flex-1 min-w-[140px] text-sm" defaultValue={s.label} onBlur={async (ev) => {
                const label = ev.target.value
                setData({ ...data, shifts: data.shifts.map((x) => x.id === s.id ? { ...x, label } : x) })
                await fetch('/api/admin/shifts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id, label }) })
              }} />
              <label className="flex flex-col gap-0.5 text-xs text-gray-600">
                <span>Début</span>
                {s.isRepos ? (
                  <input type="time" className="border rounded px-2 py-1 bg-gray-100 text-gray-500" disabled value="" />
                ) : (
                  <input
                    type="time"
                    key={`${s.id}-deb-${s.startHour}-${s.startMin}`}
                    className="border rounded px-2 py-1"
                    defaultValue={shiftTimeToInputValue(s.startHour, s.startMin)}
                    onBlur={async (ev) => {
                      const p = parseTimeInput(ev.target.value)
                      if (!p) return
                      setData({ ...data, shifts: data.shifts.map((x) => x.id === s.id ? { ...x, startHour: p.hour, startMin: p.min } : x) })
                      await fetch('/api/admin/shifts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id, startHour: p.hour, startMin: p.min }) })
                    }}
                  />
                )}
              </label>
              <label className="flex flex-col gap-0.5 text-xs text-gray-600">
                <span>Fin</span>
                {s.isRepos ? (
                  <input type="time" className="border rounded px-2 py-1 bg-gray-100 text-gray-500" disabled value="" />
                ) : (
                  <input
                    type="time"
                    key={`${s.id}-fin-${s.endHour}-${s.endMin}`}
                    className="border rounded px-2 py-1"
                    defaultValue={shiftTimeToInputValue(s.endHour, s.endMin)}
                    onBlur={async (ev) => {
                      const p = parseTimeInput(ev.target.value)
                      if (!p) return
                      setData({ ...data, shifts: data.shifts.map((x) => x.id === s.id ? { ...x, endHour: p.hour, endMin: p.min } : x) })
                      await fetch('/api/admin/shifts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id, endHour: p.hour, endMin: p.min }) })
                    }}
                  />
                )}
              </label>
              <input type="color" className="h-9 w-10 border rounded" value={s.bgColor} onChange={async (ev) => {
                const bgColor = ev.target.value
                setData({ ...data, shifts: data.shifts.map((x) => x.id === s.id ? { ...x, bgColor } : x) })
                await fetch('/api/admin/shifts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id, bgColor }) })
              }} />
              <input type="color" className="h-9 w-10 border rounded" value={s.fgColor} onChange={async (ev) => {
                const fgColor = ev.target.value
                setData({ ...data, shifts: data.shifts.map((x) => x.id === s.id ? { ...x, fgColor } : x) })
                await fetch('/api/admin/shifts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id, fgColor }) })
              }} />
              <button type="button" className="ml-auto px-3 py-2 text-sm bg-red-600 text-white rounded self-center" onClick={async () => {
                setData({ ...data, shifts: data.shifts.filter((x) => x.id !== s.id) })
                await fetch('/api/admin/shifts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id }) })
              }}>Supprimer</button>
            </div>
          ))}
        </div>
      )}

      {picker && (
        <div
          ref={pickerPopoverRef}
          className="fixed z-50 bg-white border rounded-lg shadow p-2 space-y-1"
          style={{
            left: picker.left,
            top: picker.openUpward ? undefined : picker.top,
            bottom: picker.openUpward ? picker.bottom : undefined,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {pickerShifts.map((s) => (
            <button
              key={s.id}
              type="button"
              className="w-full text-left px-2 py-1 rounded text-xs"
              style={{ backgroundColor: s.bgColor, color: s.fgColor }}
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const sl = picker.slot
                if (!sl) return
                if (picker.date && picker.employeeId) void updateOverride(picker.date, picker.employeeId, s.id, sl)
                if (picker.dayIndex != null && picker.employeeId) void updatePattern(picker.dayIndex, picker.employeeId, s.id, sl)
                setPicker(null)
              }}
            >
              {s.label} ({s.shortCode})
            </button>
          ))}
          {picker.date && picker.employeeId && picker.slot && (
            <button
              type="button"
              className="w-full text-left px-2 py-1 rounded text-xs bg-gray-100"
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                void updateOverride(picker.date!, picker.employeeId!, null, picker.slot!)
                setPicker(null)
              }}
            >
              ↩ Revenir au roulement
            </button>
          )}
        </div>
      )}
    </div>
  )
}
