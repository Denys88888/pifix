-- Photos in the order chat.
-- AlterTable
ALTER TABLE "order_messages" ADD COLUMN     "photos" TEXT[] DEFAULT ARRAY[]::TEXT[];

