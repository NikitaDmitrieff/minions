import { redirect } from 'next/navigation'

export default async function InputPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/projects/${id}/settings`)
}
