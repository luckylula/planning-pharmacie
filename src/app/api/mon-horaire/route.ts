import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non connecte' }, { status: 401 })

  const employeeId = (session.user as any).employeeId
  if (!employeeId) return NextResponse.json({ error: "Pas d employee associee" }, { status: 400 })

  const [employee, shifts, patternCells, overrides, cycleConfig] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId } }),
    prisma.shift.findMany({ orderBy: { order: 'asc' } }),
    prisma.patternCell.findMany({ where: { employeeId } }),
    prisma.scheduleOverride.findMany({ where: { employeeId } }),
    prisma.cycleConfig.findFirst(),
  ])

  return NextResponse.json({ employee, shifts, patternCells, overrides, cycleConfig })
}
