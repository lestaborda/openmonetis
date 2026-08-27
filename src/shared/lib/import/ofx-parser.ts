import { buildOfxOccurrenceKey } from "./ofx-identity";
import type { ImportedTransaction, ImportStatement } from "./types";

// Extrai o valor de uma tag leaf do OFX SGML: <TAG>valor
function getField(block: string, tag: string): string | null {
	const match = block.match(new RegExp(`<${tag}>([^<\n\r]+)`));
	return match?.[1]?.trim() ?? null;
}

// Converte data OFX "20260320000000[-3:BRT]" para "YYYY-MM-DD"
function parseOfxDate(raw: string): string {
	const match = raw.match(/^(\d{4})(\d{2})(\d{2})/);
	if (!match) throw new Error(`Data OFX inválida: ${raw}`);
	return `${match[1]}-${match[2]}-${match[3]}`;
}

export function parseOfx(content: string): ImportStatement {
	// Remove o header SGML (tudo antes de <OFX>)
	const ofxStart = content.indexOf("<OFX>");
	const xml = ofxStart >= 0 ? content.slice(ofxStart) : content;

	// Banco
	const source = getField(xml, "ORG") ?? "Desconhecido";
	const accountNumber = getField(xml, "ACCTID");

	// Período
	const dtStart = getField(xml, "DTSTART");
	const dtEnd = getField(xml, "DTEND");
	const period =
		dtStart && dtEnd
			? { from: parseOfxDate(dtStart), to: parseOfxDate(dtEnd) }
			: null;

	// Transações
	const blocks = xml.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/g) ?? [];
	const occurrenceCounts = new Map<string, number>();
	const transactions: ImportedTransaction[] = blocks.map((block) => {
		const trnType = getField(block, "TRNTYPE") ?? "DEBIT";
		const dtPosted = getField(block, "DTPOSTED") ?? "";
		const trnAmt = getField(block, "TRNAMT") ?? "0";
		const fitId = getField(block, "FITID");
		const memo = getField(block, "MEMO");
		const name = getField(block, "NAME");

		const amount = Number.parseFloat(trnAmt.replace(",", "."));
		const transactionType: ImportedTransaction["transactionType"] =
			amount > 0 || trnType === "CREDIT" ? "income" : "expense";
		const description = memo ?? name ?? "";
		const transaction = {
			externalId: fitId,
			date: parseOfxDate(dtPosted),
			amount: Math.abs(amount),
			description,
			sourceDescription: description,
			transactionType,
		};
		const occurrenceKey = buildOfxOccurrenceKey(transaction);
		const externalIdOccurrence = occurrenceKey
			? (occurrenceCounts.get(occurrenceKey) ?? 0)
			: 0;

		if (occurrenceKey) {
			occurrenceCounts.set(occurrenceKey, externalIdOccurrence + 1);
		}

		return {
			...transaction,
			externalIdOccurrence,
		};
	});

	const isCreditCard = xml.includes("<CREDITCARDMSGSRSV1>");

	return { source, accountNumber, period, isCreditCard, transactions };
}
