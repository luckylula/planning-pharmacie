import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const employees = await prisma.employee.findMany({
    orderBy: { order: 'asc' },
    select: { id: true, name: true },
  })

  return NextResponse.json({ employees })
}
