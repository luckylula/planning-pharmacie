import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

function fallbackEmployeeEmail(employeeId: string): string {
  return `employee-${employeeId}@planning.local`
}

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

  const normalizedEmail =
    typeof email === 'string' && email.trim().length > 0
      ? email.trim().toLowerCase()
      : null
  const normalizedPassword =
    typeof password === 'string' && password.trim().length > 0
      ? password.trim()
      : null

  if (normalizedEmail) {
    const exists = await prisma.user.findUnique({ where: { email: normalizedEmail } })
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
    if (normalizedPassword) {
      const hashed = await bcrypt.hash(normalizedPassword, 10)
      await tx.user.create({
        data: {
          email: normalizedEmail ?? fallbackEmployeeEmail(emp.id),
          password: hashed,
          role: 'employee',
          employeeId: emp.id,
        },
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
  const { id, name, color, email, password } = await req.json()
  const employee = await prisma.employee.update({ where: { id }, data: { name, color } })

  const normalizedEmail =
    typeof email === 'string' && email.trim().length > 0
      ? email.trim().toLowerCase()
      : null
  const normalizedPassword =
    typeof password === 'string' && password.trim().length > 0
      ? password.trim()
      : null

  if (normalizedEmail || normalizedPassword) {
    const currentUser = await prisma.user.findUnique({ where: { employeeId: id } })

    if (normalizedEmail) {
      const owner = await prisma.user.findUnique({ where: { email: normalizedEmail } })
      if (owner && owner.employeeId !== id) {
        return NextResponse.json(
          { error: 'Cet email est deja utilise par un autre compte.' },
          { status: 400 }
        )
      }
    }

    if (currentUser) {
      const updateData: { email?: string; password?: string } = {}
      if (normalizedEmail) updateData.email = normalizedEmail
      if (normalizedPassword) updateData.password = await bcrypt.hash(normalizedPassword, 10)
      if (Object.keys(updateData).length > 0) {
        await prisma.user.update({
          where: { id: currentUser.id },
          data: updateData,
        })
      }
    } else if (normalizedEmail) {
      if (!normalizedPassword) {
        return NextResponse.json(
          { error: "Code requis pour creer un compte d'acces." },
          { status: 400 }
        )
      }
      await prisma.user.create({
        data: {
          email: normalizedEmail,
          password: await bcrypt.hash(normalizedPassword, 10),
          role: 'employee',
          employeeId: id,
        },
      })
    } else if (normalizedPassword) {
      await prisma.user.create({
        data: {
          email: fallbackEmployeeEmail(id),
          password: await bcrypt.hash(normalizedPassword, 10),
          role: 'employee',
          employeeId: id,
        },
      })
    }
  }

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
