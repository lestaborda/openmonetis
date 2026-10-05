DROP INDEX "lancamentos_ofx_fit_id_user_id_idx";--> statement-breakpoint
ALTER TABLE "lancamentos" ADD COLUMN "ofx_import_fingerprint" text;--> statement-breakpoint
CREATE UNIQUE INDEX "lancamentos_ofx_import_fingerprint_user_id_idx" ON "lancamentos" USING btree ("user_id","ofx_import_fingerprint") WHERE ofx_import_fingerprint IS NOT NULL;