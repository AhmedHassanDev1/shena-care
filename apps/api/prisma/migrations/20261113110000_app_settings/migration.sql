-- CreateTable
CREATE TABLE "operations"."app_settings" (
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "operations"."app_setting_changes" (
    "id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "previous" JSONB,
    "current" JSONB,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_setting_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_setting_changes_key_created_at_idx" ON "operations"."app_setting_changes"("key", "created_at");

-- CreateIndex
CREATE INDEX "app_setting_changes_created_at_idx" ON "operations"."app_setting_changes"("created_at");
