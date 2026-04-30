import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isSaturdayAfternoonSlot } from '@/lib/schedule'
import { Slot } from '@prisma/client'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
  }
  const { dayIndex, employeeId, shiftId, slot: slotRaw } = await req.json()
  if (slotRaw !== 'MATIN' && slotRaw !== 'APREM') {
    return NextResponse.json({ error: 'slot requis (MATIN ou APREM)' }, { status: 400 })
  }
  const slot = slotRaw === 'APREM' ? Slot.APREM : Slot.MATIN
  if (isSaturdayAfternoonSlot(dayIndex % 7, slot)) {
    return NextResponse.json({ error: 'La pharmacie est fermee le samedi apres-midi' }, { status: 400 })
  }
  const cell = await prisma.patternCell.upsert({
    where: { dayIndex_employeeId_slot: { dayIndex, employeeId, slot } },
    update: { shiftId },
    create: { dayIndex, employeeId, shiftId, slot },
  })
  return NextResponse.json(cell)
}
