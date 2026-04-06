export type Slot = 'MATIN' | 'APREM'

export type Employee = {
  id: string
  name: string
  color: string
  order: number
}

export type Shift = {
  id: string
  label: string
  shortCode: string
  startHour: number | null
  startMin: number | null
  endHour: number | null
  endMin: number | null
  bgColor: string
  fgColor: string
  isRepos: boolean
  order: number
}

export type PatternCell = {
  id: string
  dayIndex: number
  employeeId: string
  shiftId: string
  slot: Slot
}

export type ScheduleOverride = {
  id: string
  date: string
  employeeId: string
  shiftId: string
  slot: Slot
}

export type CycleConfig = {
  id: string
  startDate: string
}

export type ScheduleData = {
  employees: Employee[]
  shifts: Shift[]
  patternCells: PatternCell[]
  overrides: ScheduleOverride[]
  cycleConfig: CycleConfig | null
}
