CREATE TABLE "site_settings" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"default_theme" text DEFAULT 'ruby-dark' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "site_settings_singleton" CHECK ("id" = 'global'),
	CONSTRAINT "site_settings_theme" CHECK ("default_theme" IN ('ruby-dark', 'ruby-light'))
);
--> statement-breakpoint
ALTER TABLE "directory_businesses" ADD COLUMN "permanently_closed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "directory_businesses" ADD COLUMN "reviews_closed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "directory_businesses" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_businesses" ADD CONSTRAINT "directory_business_closed_reviews" CHECK (NOT "permanently_closed" OR "reviews_closed");