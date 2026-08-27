"use client";

import { RiErrorWarningLine } from "@remixicon/react";
import { catchError, type ErrorInfo } from "next/error";
import { EmptyState } from "@/shared/components/feedback/empty-state";
import { Button } from "@/shared/components/ui/button";

type ContentErrorBoundaryProps = {
	title: string;
	description: string;
};

function ContentErrorFallback(
	{ title, description }: ContentErrorBoundaryProps,
	{ retry }: ErrorInfo,
) {
	return (
		<div
			role="alert"
			className="flex min-h-64 w-full items-center justify-center"
		>
			<EmptyState
				title={title}
				description={description}
				media={<RiErrorWarningLine className="size-5 text-destructive" />}
				mediaVariant="icon"
				className="min-h-64 border border-dashed"
			>
				<Button type="button" variant="outline" onClick={retry}>
					Tentar novamente
				</Button>
			</EmptyState>
		</div>
	);
}

export const ContentErrorBoundary =
	catchError<ContentErrorBoundaryProps>(ContentErrorFallback);
