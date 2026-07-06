import { and, eq } from "drizzle-orm";
import { categories } from "@/db/schema";
import { db } from "@/shared/lib/db";

export const RECEIVABLE_CATEGORY_NAME = "A receber";

export async function getReceivableCategoryId(
	userId: string,
): Promise<string | null> {
	const category = await db.query.categories.findFirst({
		columns: { id: true },
		where: and(
			eq(categories.userId, userId),
			eq(categories.name, RECEIVABLE_CATEGORY_NAME),
			eq(categories.type, "receita"),
		),
	});

	return category?.id ?? null;
}

export async function ensureReceivableCategoryForUser(
	userId: string,
): Promise<string> {
	const existingId = await getReceivableCategoryId(userId);
	if (existingId) {
		return existingId;
	}

	const [created] = await db
		.insert(categories)
		.values({
			name: RECEIVABLE_CATEGORY_NAME,
			type: "receita",
			icon: "RiHandCoinLine",
			userId,
		})
		.returning({ id: categories.id });

	if (!created) {
		throw new Error('Não foi possível criar a categoria "A receber".');
	}

	return created.id;
}
