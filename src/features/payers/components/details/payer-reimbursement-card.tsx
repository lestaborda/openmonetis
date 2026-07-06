import MoneyValues from "@/shared/components/money-values";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/shared/components/ui/card";
import type { PayerReimbursementSummary } from "@/shared/lib/payers/details";
import { formatDate } from "@/shared/utils/date";

type PayerReimbursementCardProps = {
	periodLabel: string;
	summary: PayerReimbursementSummary;
};

export function PayerReimbursementCard({
	periodLabel,
	summary,
}: PayerReimbursementCardProps) {
	return (
		<Card>
			<CardHeader className="flex flex-col gap-1.5">
				<CardTitle className="text-lg font-semibold">
					Reembolsos do mês
				</CardTitle>
				<p className="text-xs text-muted-foreground">
					{periodLabel} — valores a receber desta pessoa
				</p>
			</CardHeader>
			<CardContent className="space-y-4 pt-0">
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="rounded-lg border bg-muted/20 px-3 py-2.5">
						<p className="text-xs text-muted-foreground">A reembolsar</p>
						<MoneyValues
							amount={summary.pendingAmount}
							className="text-2xl font-semibold text-foreground"
						/>
						<p className="text-xs text-muted-foreground">
							{summary.pendingCount} lançamento
							{summary.pendingCount === 1 ? "" : "s"} pendente
							{summary.pendingCount === 1 ? "" : "s"}
						</p>
					</div>
					<div className="rounded-lg border px-3 py-2.5">
						<p className="text-xs text-muted-foreground">Já recebido</p>
						<MoneyValues
							amount={summary.receivedAmount}
							className="text-2xl font-semibold text-success"
						/>
					</div>
				</div>

				{summary.pendingItems.length > 0 ? (
					<ul className="space-y-2">
						{summary.pendingItems.slice(0, 5).map((item) => (
							<li
								key={item.id}
								className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
							>
								<div className="min-w-0">
									<p className="truncate font-medium">{item.name}</p>
									<p className="text-xs text-muted-foreground">
										{formatDate(item.purchaseDate)}
									</p>
								</div>
								<MoneyValues amount={item.amount} className="font-medium" />
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">
						Nenhum valor pendente de reembolso neste período.
					</p>
				)}

				{summary.pendingCount > 5 ? (
					<p className="text-xs text-muted-foreground">
						Mostra 5 de {summary.pendingCount} pendentes. Veja todos na aba
						Lançamentos com o filtro &quot;A receber&quot;.
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}
