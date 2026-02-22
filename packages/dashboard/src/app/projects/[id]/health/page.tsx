import { redirect } from 'next/navigation'

export default async function HealthPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/projects/${id}/findings`)
}
