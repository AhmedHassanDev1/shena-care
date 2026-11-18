-- CreateEnum
CREATE TYPE "care"."CareFocus" AS ENUM ('skin', 'hair', 'both');

-- CreateEnum
CREATE TYPE "care"."SunExposure" AS ENUM ('low', 'moderate', 'high');

-- CreateEnum
CREATE TYPE "care"."PreferredTexture" AS ENUM ('gel', 'cream', 'lotion', 'fluid', 'rich_cream');

-- AlterTable
ALTER TABLE "care"."customer_care_profiles"
ADD COLUMN "primary_focus" "care"."CareFocus" DEFAULT 'both',
ADD COLUMN "sun_exposure" "care"."SunExposure",
ADD COLUMN "preferred_texture" "care"."PreferredTexture";
