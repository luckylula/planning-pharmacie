import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
  }
  const employees = await prisma.employee.findMany({
    orderBy: { order: 'asc' },
    include: { user: { select: { email: true, role: true } } },
  })
  return NextResponse.json(employees)
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
  }
  const { name, color, email, password } = await req.json()
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) {
    return NextResponse.json({ error: 'Nom requis' }, { status: 400 })
  }

  if (email && password) {
    const exists = await prisma.user.findUnique({ where: { email } })
    if (exists) {
      return NextResponse.json(
        { error: "Cet email est deja utilise (ex. compte admin). Laissez l'email vide pour ajouter seulement un employe." },
        { status: 400 }
      )
    }
  }

  const employee = await prisma.$transaction(async (tx) => {
    const emp = await tx.employee.create({
      data: { name: trimmed, color: color || '#607d8b' },
    })
    if (email && password) {
      const hashed = await bcrypt.hash(password, 10)
      await tx.user.create({
        data: { email, password: hashed, role: 'employee', employeeId: emp.id },
      })
    }
    return emp
  })

  return NextResponse.json(employee)
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
  }
  const { id, name, color } = await req.json()
  const employee = await prisma.employee.update({ where: { id }, data: { name, color } })
  return NextResponse.json(employee)
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
  }
  const { id } = await req.json()
  await prisma.employee.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
