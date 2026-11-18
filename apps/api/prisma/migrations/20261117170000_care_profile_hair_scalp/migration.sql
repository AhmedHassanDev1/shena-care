-- CreateEnum
CREATE TYPE "care"."HairType" AS ENUM ('straight', 'wavy', 'curly', 'coily');

-- CreateEnum
CREATE TYPE "care"."ScalpType" AS ENUM ('normal', 'dry', 'oily', 'sensitive');

-- AlterTable
ALTER TABLE "care"."customer_care_profiles" ADD COLUMN     "hair_type" "care"."HairType",
ADD COLUMN     "scalp_type" "care"."ScalpType";
