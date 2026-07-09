"use server";

import { and, eq } from "drizzle-orm";
import { transactions } from "@/db/schema";
import {
	buildSplitGroupContext,
	fetchSplitGroupMembers,
	type SplitGroupContext,
} from "@/features/transactions/lib/split-group";
import { getUser } from "@/shared/lib/auth/server";
import { db } from "@/shared/lib/db";

export async function fetchSplitGroupContextAction(
	splitGroupId: string,
	preferredId?: string,
): Promise<SplitGroupContext | null> {
	const user = await getUser();
	const members = await fetchSplitGroupMembers(user.id, splitGroupId);
	return buildSplitGroupContext(members, preferredId);
}

export async function fetchSplitGroupContextForTransactionAction(
	transactionId: string,
): Promise<SplitGroupContext | null> {
	const user = await getUser();
	const row = await db.query.transactions.findFirst({
		columns: { splitGroupId: true },
		where: and(
			eq(transactions.id, transactionId),
			eq(transactions.userId, user.id),
		),
	});
	if (!row?.splitGroupId) return null;
	const members = await fetchSplitGroupMembers(user.id, row.splitGroupId);
	return buildSplitGroupContext(members, transactionId);
}
