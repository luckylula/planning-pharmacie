import { redirect } from 'next/navigation'

export default function AdminShiftsPage() {
  redirect('/admin?tab=shifts')
}
