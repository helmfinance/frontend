import { redirect } from "next/navigation";

/**
 * Legacy mint route — superseded by the MintModal launched from
 * /agents/{id}. Kept as a permanent redirect so old links (Mantlescan,
 * docs, screenshots) keep landing in the right place.
 */
export default async function MintRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/agents/${id}?action=mint`);
}
