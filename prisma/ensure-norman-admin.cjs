/**
 * Met a jour la base existante : compte admin norman@pharmacie.fr
 * lie a un employe dedie "Norman" (cree si absent).
 *
 * Executer : npm run db:ensure-norman
 *
 * Optionnel : definir le mot de passe (bcrypt) sans refaire un seed complet :
 *   PowerShell: $env:NORMAN_PASSWORD="votre-mot-de-passe"; npm run db:ensure-norman
 *   bash:       NORMAN_PASSWORD="votre-mot-de-passe" npm run db:ensure-norman
 * Utiliser la meme DATABASE_URL que la cible (local ou prod).
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })

const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()

const EMAIL_NEW = 'norman@pharmacie.fr'
const EMAIL_OLD = 'norma@pharmacie.fr'

async function main() {
  let normanEmp = await prisma.employee.findFirst({ where: { name: 'Norman' } })

  if (!normanEmp) {
    normanEmp = await prisma.$transaction(async (tx) => {
      await tx.employee.updateMany({ data: { order: { increment: 1 } } })
      return tx.employee.create({
        data: { name: 'Norman', color: '#3949ab', order: 0 },
      })
    })
    console.log('Employe "Norman" cree (ordre 0, autres numeros decales de +1).')
  } else {
    console.log('Employe "Norman" existe deja.')
  }

  const userNew = await prisma.user.findUnique({ where: { email: EMAIL_NEW } })
  const userOld = await prisma.user.findUnique({ where: { email: EMAIL_OLD } })
  const pwdPlain = process.env.NORMAN_PASSWORD

  if (userNew && userNew.employeeId === normanEmp.id && userNew.role === 'admin') {
    if (pwdPlain) {
      await prisma.user.update({
        where: { id: userNew.id },
        data: { password: bcrypt.hashSync(pwdPlain, 10) },
      })
      console.log('Mot de passe mis a jour pour', EMAIL_NEW, '(NORMAN_PASSWORD).')
    } else {
      console.log('Deja correct :', EMAIL_NEW, 'admin, lie a Norman.')
    }
    return
  }

  if (userOld && userNew && userOld.id !== userNew.id) {
    await prisma.user.delete({ where: { id: userNew.id } })
    console.log(
      'Ancienne fiche User en double sur',
      EMAIL_NEW,
      'supprimee (remplacee par la migration depuis',
      EMAIL_OLD,
      ').'
    )
  }

  if (userOld) {
    const data = {
      email: EMAIL_NEW,
      role: 'admin',
      employeeId: normanEmp.id,
      ...(pwdPlain ? { password: bcrypt.hashSync(pwdPlain, 10) } : {}),
    }
    await prisma.user.update({
      where: { id: userOld.id },
      data,
    })
    console.log(
      'OK :',
      EMAIL_OLD,
      '->',
      EMAIL_NEW,
      '+ admin + employe Norman' +
        (pwdPlain ? ' + mot de passe (NORMAN_PASSWORD)' : '') +
        '.'
    )
    return
  }

  if (userNew) {
    const data = {
      role: 'admin',
      employeeId: normanEmp.id,
      ...(pwdPlain
        ? { password: bcrypt.hashSync(pwdPlain, 10) }
        : {}),
    }
    await prisma.user.update({
      where: { id: userNew.id },
      data,
    })
    console.log(
      'OK : compte existant',
      EMAIL_NEW,
      'mis a jour (admin + employe Norman' +
        (pwdPlain ? ' + mot de passe mis a jour depuis NORMAN_PASSWORD' : '') +
        ').'
    )
    return
  }

  if (pwdPlain) {
    const hash = bcrypt.hashSync(pwdPlain, 10)
    await prisma.user.create({
      data: {
        email: EMAIL_NEW,
        password: hash,
        role: 'admin',
        employeeId: normanEmp.id,
      },
    })
    console.log('OK : compte', EMAIL_NEW, 'cree (admin + employe Norman).')
    return
  }

  console.warn(
    'Aucun utilisateur',
    EMAIL_OLD,
    'ni',
    EMAIL_NEW,
    '. Lancez db:seed sur une base vide, ou definissez NORMAN_PASSWORD et relancez ce script pour creer le compte.'
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
