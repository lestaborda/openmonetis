import "server-only";

import { createHash } from "node:crypto";
import {
	buildOfxFingerprintPayload,
	type OfxIdentityRow,
	type OfxImportDestination,
} from "@/shared/lib/import/ofx-identity";

type CreateOfxImportFingerprintInput = {
	source: string;
	accountNumber: string | null;
	destination: OfxImportDestination;
	row: OfxIdentityRow;
};

export function createOfxImportFingerprint(
	input: CreateOfxImportFingerprintInput,
): string | null {
	const payload = buildOfxFingerprintPayload(input);
	if (!payload) return null;

	return createHash("sha256").update(payload).digest("hex");
}
