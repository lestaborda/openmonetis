import { formatDecimalForDbRequired } from "@/shared/utils/currency";

export type OfxImportDestination = {
	type: "account" | "card";
	id: string;
};

export type OfxIdentityRow = {
	externalId: string | null;
	externalIdOccurrence: number;
	date: string;
	amount: number;
	transactionType: "income" | "expense";
	sourceDescription: string;
};

type OfxIdentityInput = {
	source: string;
	accountNumber: string | null;
	destination: OfxImportDestination;
	row: OfxIdentityRow;
};

export function normalizeOfxIdentityText(value: string): string {
	return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function buildOfxOccurrenceKey(
	row: Omit<OfxIdentityRow, "externalIdOccurrence">,
): string | null {
	if (!row.externalId) return null;

	const signedAmount =
		row.transactionType === "expense" ? -row.amount : row.amount;

	return JSON.stringify([
		row.externalId.trim(),
		row.date,
		formatDecimalForDbRequired(signedAmount),
		row.transactionType,
		normalizeOfxIdentityText(row.sourceDescription),
	]);
}

export function buildOfxFingerprintPayload({
	source,
	accountNumber,
	destination,
	row,
}: OfxIdentityInput): string | null {
	if (!row.externalId) return null;

	const signedAmount =
		row.transactionType === "expense" ? -row.amount : row.amount;

	return JSON.stringify([
		"openmonetis-ofx-v1",
		normalizeOfxIdentityText(source),
		normalizeOfxIdentityText(accountNumber ?? ""),
		destination.type,
		destination.id,
		row.externalId.trim(),
		row.date,
		formatDecimalForDbRequired(signedAmount),
		row.transactionType,
		normalizeOfxIdentityText(row.sourceDescription),
		row.externalIdOccurrence,
	]);
}
