import { PatternCell, ScheduleOverride, Shift, Slot } from '@/types'

const DAYS_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const MONTHS_FR = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre']

export { DAYS_FR, MONTHS_FR }

export const formatDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const parseLocalDate = (s: string): Date => new Date(`${s}T00:00:00`)

export const getDayOfWeek = (d: Date): number => {
  const w = d.getDay()
  return w === 0 ? 6 : w - 1
}

export const getDaysInMonth = (year: number, month: number): Date[] => {
  const total = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: total }, (_, i) => new Date(year, month, i + 1))
}

export const shiftHours = (shift: Shift | undefined): number => {
  if (!shift || shift.startHour == null || shift.endHour == null || shift.startMin == null || shift.endMin == null) return 0
  return (shift.endHour * 60 + shift.endMin - shift.startHour * 60 - shift.startMin) / 60
}

export function getShiftIdForDate(
  employeeId: string,
  date: Date,
  slot: Slot,
  patternCells: PatternCell[],
  overrides: ScheduleOverride[],
  cycleStartDate: Date,
  reposShiftId: string
): string {
  const weekday = getDayOfWeek(date)
  // Regle metier: samedi apres-midi ferme (affiche Repos).
  if (weekday === 5 && slot === 'APREM') return reposShiftId

  const dateStr = formatDate(date)
  const override = overrides.find(
    (o) => formatDate(new Date(o.date)) === dateStr && o.employeeId === employeeId && o.slot === slot
  )
  if (override) return override.shiftId

  const start = new Date(cycleStartDate)
  start.setHours(0, 0, 0, 0)
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const diff = Math.round((d.getTime() - start.getTime()) / 86400000)
  const idx = ((diff % 14) + 14) % 14
  const cell = patternCells.find(
    (c) => c.dayIndex === idx && c.employeeId === employeeId && c.slot === slot
  )
  return cell ? cell.shiftId : reposShiftId
}
