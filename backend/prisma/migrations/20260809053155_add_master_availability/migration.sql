-- AlterTable
ALTER TABLE "master_profiles" ADD COLUMN     "isAvailable" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "master_profiles_isAvailable_idx" ON "master_profiles"("isAvailable");

