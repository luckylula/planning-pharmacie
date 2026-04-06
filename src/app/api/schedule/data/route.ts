import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
  }

  const [employees, shifts, patternCells, overrides, cycleConfig] = await Promise.all([
    prisma.employee.findMany({ orderBy: { order: 'asc' } }),
    prisma.shift.findMany({ orderBy: { order: 'asc' } }),
    prisma.patternCell.findMany(),
    prisma.scheduleOverride.findMany(),
    prisma.cycleConfig.findFirst(),
  ])

  return NextResponse.json({ employees, shifts, patternCells, overrides, cycleConfig })
}
