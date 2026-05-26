import { redirect } from "next/navigation";

/**
 * Legacy redeem route — superseded by the RedeemModal launched from
 * /agents/{id}. Kept as a permanent redirect so old links (Portfolio
 * "Redeem" CTA, docs, screenshots) keep landing in the right place.
 */
export default async function RedeemRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/agents/${id}?action=redeem`);
}
