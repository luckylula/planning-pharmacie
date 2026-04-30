import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getDayOfWeek, isSaturdayAfternoonSlot } from '@/lib/schedule'
import { Slot } from '@prisma/client'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
  }
  const { date, employeeId, shiftId, slot: slotRaw } = await req.json()
  if (slotRaw !== 'MATIN' && slotRaw !== 'APREM') {
    return NextResponse.json({ error: 'slot requis (MATIN ou APREM)' }, { status: 400 })
  }
  const slot = slotRaw === 'APREM' ? Slot.APREM : Slot.MATIN
  const d = new Date(date)
  if (isSaturdayAfternoonSlot(getDayOfWeek(d), slot)) {
    return NextResponse.json({ error: 'La pharmacie est fermee le samedi apres-midi' }, { status: 400 })
  }
  const override = await prisma.scheduleOverride.upsert({
    where: { date_employeeId_slot: { date: d, employeeId, slot } },
    update: { shiftId },
    create: { date: d, employeeId, shiftId, slot },
  })
  return NextResponse.json(override)
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
  }
  const { date, employeeId, slot: slotRaw } = await req.json()
  if (slotRaw !== 'MATIN' && slotRaw !== 'APREM') {
    return NextResponse.json({ error: 'slot requis (MATIN ou APREM)' }, { status: 400 })
  }
  const slot = slotRaw === 'APREM' ? Slot.APREM : Slot.MATIN
  await prisma.scheduleOverride.delete({
    where: { date_employeeId_slot: { date: new Date(date), employeeId, slot } },
  })
  return NextResponse.json({ ok: true })
}
