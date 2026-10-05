export type ImportedTransaction = {
	externalId: string | null; // FITID do OFX
	externalIdOccurrence: number; // posição entre registros OFX idênticos
	date: string; // YYYY-MM-DD
	amount: number; // positivo = receita, negativo = despesa
	description: string; // MEMO ou NAME
	sourceDescription: string; // descrição original, preservada para deduplicação
	transactionType: "income" | "expense";
	categoryRaw?: string | null;
};

export type ImportStatement = {
	source: string; // nome do banco (ORG)
	accountNumber: string | null; // ACCTID
	period: { from: string; to: string } | null; // YYYY-MM-DD
	isCreditCard: boolean; // true = CREDITCARDMSGSRSV1
	transactions: ImportedTransaction[];
};
