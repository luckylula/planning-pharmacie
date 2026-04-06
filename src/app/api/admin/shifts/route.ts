import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const shifts = await prisma.shift.findMany({ orderBy: { order: 'asc' } })
  return NextResponse.json(shifts)
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
  }
  const data = await req.json()
  const shift = await prisma.shift.create({ data })
  return NextResponse.json(shift)
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
  }
  const { id, ...data } = await req.json()
  const shift = await prisma.shift.update({ where: { id }, data })
  return NextResponse.json(shift)
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
  }
  const { id } = await req.json()
  await prisma.shift.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
