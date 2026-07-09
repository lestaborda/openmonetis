import type { TransactionItem } from "@/features/transactions/components/types";

export type TransactionPersonDisplay = {
	payerId: string | null;
	name: string | null;
	avatar: string | null;
	subtitle: string | null;
};

export function getTransactionPersonDisplay(
	item: TransactionItem,
): TransactionPersonDisplay {
	if (item.reimbursementDebtorId && item.reimbursementDebtorName) {
		return {
			payerId: item.reimbursementDebtorId,
			name: item.reimbursementDebtorName,
			avatar: item.reimbursementDebtorAvatar,
			subtitle: "A receber",
		};
	}

	return {
		payerId: item.payerId,
		name: item.pagadorName,
		avatar: item.pagadorAvatar,
		subtitle: null,
	};
}
