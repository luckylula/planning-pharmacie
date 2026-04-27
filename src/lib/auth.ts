import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        employeeId: { label: 'Employe', type: 'text' },
        code: { label: 'Code', type: 'password' },
        email: { label: 'Email', type: 'email' },
        password: { label: 'Mot de passe', type: 'password' },
      },
      async authorize(credentials) {
        const employeeId = typeof credentials?.employeeId === 'string' ? credentials.employeeId.trim() : ''
        const code = typeof credentials?.code === 'string' ? credentials.code : ''
        const email = typeof credentials?.email === 'string' ? credentials.email.trim().toLowerCase() : ''
        const password = typeof credentials?.password === 'string' ? credentials.password : ''

        let user: Prisma.UserGetPayload<{ include: { employee: true } }> | null = null
        let secret = ''

        if (employeeId && code) {
          user = await prisma.user.findUnique({
            where: { employeeId },
            include: { employee: true },
          })
          secret = code
        } else if (email && password) {
          user = await prisma.user.findUnique({
            where: { email },
            include: { employee: true },
          })
          secret = password
        } else {
          return null
        }

        if (!user) return null
        const valid = await bcrypt.compare(secret, user.password)
        if (!valid) return null
        return {
          id: user.id,
          email: user.email,
          role: user.role,
          employeeId: user.employeeId,
          name: user.employee?.name ?? user.email,
        } as any
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        ;(token as any).role = (user as any).role
        ;(token as any).employeeId = (user as any).employeeId
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        ;(session.user as any).role = (token as any).role
        ;(session.user as any).employeeId = (token as any).employeeId
      }
      return session
    },
  },
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
}
