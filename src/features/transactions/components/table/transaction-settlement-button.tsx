"use client";

import {
	RiBankCard2Line,
	RiCheckboxBlankCircleLine,
	RiCheckboxCircleFill,
} from "@remixicon/react";
import {
	CREDIT_CARD_PAYMENT_METHOD,
	SETTLEABLE_PAYMENT_METHODS,
} from "@/features/transactions/lib/constants";
import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/utils/ui";
import type { TransactionItem } from "../types";

type TransactionSettlementButtonProps = {
	item: TransactionItem;
	isLoading: boolean;
	onToggle?: (item: TransactionItem) => void;
};

export function TransactionSettlementButton({
	item,
	isLoading,
	onToggle,
}: TransactionSettlementButtonProps) {
	const isReceivable = Boolean(item.reimbursementDebtorId);
	const isCreditCard = item.paymentMethod === CREDIT_CARD_PAYMENT_METHOD;
	const canToggleSettlement =
		isReceivable ||
		(SETTLEABLE_PAYMENT_METHODS as readonly string[]).includes(
			item.paymentMethod,
		);

	if (!canToggleSettlement && !isCreditCard) {
		return null;
	}

	if (isCreditCard) {
		const invoicePaid = Boolean(item.isSettled);

		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<span className="inline-flex">
						<Button
							variant="ghost"
							size="icon-sm"
							disabled
							className={cn(
								"transition-colors",
								invoicePaid
									? "bg-success/10 text-success"
									: "text-muted-foreground/30",
							)}
						>
							{invoicePaid ? (
								<RiCheckboxCircleFill className="size-4" aria-hidden />
							) : (
								<RiBankCard2Line className="size-4" aria-hidden />
							)}
							<span className="sr-only">
								{invoicePaid
									? "Fatura paga"
									: "Lançamento de cartão de crédito"}
							</span>
						</Button>
					</span>
				</TooltipTrigger>
				<TooltipContent side="top" className="max-w-48 text-center">
					{invoicePaid
						? "Fatura paga"
						: "Lançamentos de cartão de crédito são liquidados ao pagar a fatura"}
				</TooltipContent>
			</Tooltip>
		);
	}

	const settled = Boolean(item.isSettled);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={() => onToggle?.(item)}
					disabled={isLoading || item.readonly}
					className={cn(
						"transition-colors",
						settled
							? "bg-success/10 text-success hover:bg-success/20 hover:text-success"
							: isReceivable
								? "text-info hover:text-info"
								: "text-muted-foreground hover:text-foreground",
					)}
				>
					{isLoading ? (
						<Spinner className="size-4" />
					) : settled ? (
						<RiCheckboxCircleFill className="size-4" aria-hidden />
					) : (
						<RiCheckboxBlankCircleLine className="size-4" aria-hidden />
					)}
					<span className="sr-only">
						{isReceivable
							? settled
								? "Desfazer recebimento"
								: "Marcar como recebido"
							: settled
								? "Desfazer pagamento"
								: "Marcar como pago"}
					</span>
				</Button>
			</TooltipTrigger>
			<TooltipContent side="top">
				{isReceivable
					? settled
						? "Desfazer recebimento"
						: "Marcar como recebido"
					: settled
						? "Desfazer pagamento"
						: "Marcar como pago"}
			</TooltipContent>
		</Tooltip>
	);
}
