import { connection } from "next/server";
import { AttachmentsPage } from "@/features/attachments/components/attachments-page";
import { fetchAttachmentsPageData } from "@/features/attachments/queries";
import { ContentErrorBoundary } from "@/shared/components/feedback/content-error-boundary";
import { getUserId } from "@/shared/lib/auth/server";
import { parsePeriodParam } from "@/shared/utils/period";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

type PageProps = {
	searchParams?: PageSearchParams;
};

const getSingleParam = (
	params: Record<string, string | string[] | undefined> | undefined,
	key: string,
) => {
	const value = params?.[key];
	if (!value) return null;
	return Array.isArray(value) ? (value[0] ?? null) : value;
};

export default function Page({ searchParams }: PageProps) {
	return (
		<ContentErrorBoundary
			title="Não foi possível carregar os anexos"
			description="Os documentos e comprovantes não puderam ser carregados agora."
		>
			<AttachmentsContent searchParams={searchParams} />
		</ContentErrorBoundary>
	);
}

async function AttachmentsContent({ searchParams }: PageProps) {
	await connection();
	const userId = await getUserId();
	const resolvedSearchParams = searchParams ? await searchParams : undefined;
	const periodoParam = getSingleParam(resolvedSearchParams, "periodo");
	const { period } = parsePeriodParam(periodoParam);

	const data = await fetchAttachmentsPageData(userId, period);

	return (
		<main className="flex flex-col gap-6">
			<AttachmentsPage
				attachments={data?.attachments ?? []}
				adminPayerId={data?.adminPayerId ?? ""}
			/>
		</main>
	);
}
