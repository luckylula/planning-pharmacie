import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
  }
  const { startDate } = await req.json()
  const existing = await prisma.cycleConfig.findFirst()
  const config = existing
    ? await prisma.cycleConfig.update({ where: { id: existing.id }, data: { startDate: new Date(startDate) } })
    : await prisma.cycleConfig.create({ data: { startDate: new Date(startDate) } })
  return NextResponse.json(config)
}
