import { connection } from "next/server";
import { InstallmentAnalysisPage } from "@/features/dashboard/components/installment-analysis/installment-analysis-page";
import { fetchInstallmentAnalysis } from "@/features/dashboard/expenses/installment-analysis-queries";
import { LogoPrefetchProvider } from "@/shared/components/entity-avatar";
import { ContentErrorBoundary } from "@/shared/components/feedback/content-error-boundary";
import { getUser } from "@/shared/lib/auth/server";
import { prefetchLogoMappings } from "@/shared/lib/logo/prefetch-server";

export default function Page() {
	return (
		<ContentErrorBoundary
			title="Não foi possível carregar a análise de parcelas"
			description="Os parcelamentos não puderam ser analisados agora."
		>
			<InstallmentAnalysisContent />
		</ContentErrorBoundary>
	);
}

async function InstallmentAnalysisContent() {
	await connection();
	const user = await getUser();
	const data = await fetchInstallmentAnalysis(user.id);
	const logoMappings = await prefetchLogoMappings(
		user.id,
		data.installmentGroups.map((group) => group.name),
	);

	return (
		<main className="flex flex-col gap-4 pb-8">
			<LogoPrefetchProvider mappings={logoMappings}>
				<InstallmentAnalysisPage data={data} />
			</LogoPrefetchProvider>
		</main>
	);
}
