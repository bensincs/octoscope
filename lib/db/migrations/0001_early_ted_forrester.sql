CREATE TABLE "project_collaborators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid,
	"login" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_collaborators" ADD CONSTRAINT "project_collaborators_project_id_audit_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."audit_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_collaborators" ADD CONSTRAINT "project_collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_collaborators_project_idx" ON "project_collaborators" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_collaborators_user_idx" ON "project_collaborators" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_collaborators_unique" ON "project_collaborators" USING btree ("project_id","login");