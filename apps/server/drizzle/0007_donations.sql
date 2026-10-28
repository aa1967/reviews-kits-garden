CREATE TABLE "donation_wallets" (
	"currency" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "donation_wallets_currency" CHECK ("donation_wallets"."currency" IN ('BTC', 'LTC', 'XMR')),
	CONSTRAINT "donation_wallets_configured" CHECK (NOT "donation_wallets"."enabled" OR length("donation_wallets"."address") > 0)
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"currency" text NOT NULL,
	"wallet_address" text NOT NULL,
	"declared_atomic" numeric(30, 0) NOT NULL,
	"confirmed_atomic" numeric(30, 0),
	"public_credit" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"transaction_id" text,
	"donor_note" text DEFAULT '' NOT NULL,
	"decision_reason" text,
	"reviewed_by" uuid,
	"received_at" timestamp,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "donations_currency" CHECK ("donations"."currency" IN ('BTC', 'LTC', 'XMR')),
	CONSTRAINT "donations_status" CHECK ("donations"."status" IN ('pending', 'confirmed', 'rejected', 'reversed')),
	CONSTRAINT "donations_positive" CHECK ("donations"."declared_atomic" > 0 AND ("donations"."confirmed_atomic" IS NULL OR "donations"."confirmed_atomic" > 0)),
	CONSTRAINT "donations_verified" CHECK ("donations"."status" NOT IN ('confirmed', 'reversed') OR
    ("donations"."confirmed_atomic" IS NOT NULL AND "donations"."received_at" IS NOT NULL AND "donations"."confirmed_at" IS NOT NULL AND "donations"."transaction_id" IS NOT NULL)),
	CONSTRAINT "donations_tx_format" CHECK ("donations"."transaction_id" IS NULL OR "donations"."transaction_id" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "donation_wallets" ADD CONSTRAINT "donation_wallets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "donations_confirmed_transaction" ON "donations" USING btree ("currency","transaction_id") WHERE "donations"."status" = 'confirmed';--> statement-breakpoint
CREATE INDEX "donations_user_history" ON "donations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "donations_confirmed_totals" ON "donations" USING btree ("currency","status","received_at");