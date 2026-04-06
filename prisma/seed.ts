import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const hashedPassword = await bcrypt.hash('pharmacie2026', 10)

  const normanEmployee = await prisma.employee.create({
    data: { name: 'Norman', color: '#3949ab', order: 0 },
  })

  await prisma.user.create({
    data: {
      email: 'norman@pharmacie.fr',
      password: hashedPassword,
      role: 'admin',
      employeeId: normanEmployee.id,
    },
  })

  const employees = [
    { name: 'Norma', color: '#5c6bc0', order: 1 },
    { name: 'Nelly', color: '#2e7d32', order: 2 },
    { name: 'Vero', color: '#1565c0', order: 3 },
    { name: 'Farida', color: '#e65100', order: 4 },
    { name: 'Emilie', color: '#6a1b9a', order: 5 },
    { name: 'Anna', color: '#ad1457', order: 6 },
    { name: 'Shana', color: '#00838f', order: 7 },
    { name: 'Jane', color: '#558b2f', order: 8 },
  ]

  for (const emp of employees) {
    await prisma.employee.create({ data: emp })
  }

  const shifts = [
    { label: 'Matin', shortCode: 'MAT', startHour: 9, startMin: 0, endHour: 12, endMin: 30, bgColor: '#c8e6c9', fgColor: '#1b5e20', order: 0 },
    { label: 'Apres-midi', shortCode: 'APM', startHour: 12, startMin: 45, endHour: 19, endMin: 20, bgColor: '#fff9c4', fgColor: '#f57f17', order: 1 },
    { label: '18h15', shortCode: '18h15', startHour: 12, startMin: 45, endHour: 19, endMin: 20, bgColor: '#ffe0b2', fgColor: '#e65100', order: 2 },
    { label: '18h30', shortCode: '18h30', startHour: 12, startMin: 30, endHour: 19, endMin: 20, bgColor: '#ffccbc', fgColor: '#bf360c', order: 3 },
    { label: 'Repos', shortCode: '-', startHour: null, startMin: null, endHour: null, endMin: null, bgColor: '#eeeeee', fgColor: '#757575', isRepos: true, order: 4 },
  ]

  for (const shift of shifts) {
    await prisma.shift.create({ data: shift })
  }

  await prisma.cycleConfig.create({
    data: { startDate: new Date('2026-03-02T00:00:00.000Z') },
  })

  console.log('Seed termine')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
