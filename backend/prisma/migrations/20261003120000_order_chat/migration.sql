-- Order chat, dispute opener and the admin's visible decision.

CREATE TYPE "MessageRole" AS ENUM ('CLIENT', 'MASTER', 'ADMIN');

ALTER TABLE "orders"
  ADD COLUMN "disputedById" TEXT,
  ADD COLUMN "disputeOpenedAt" TIMESTAMP(3),
  ADD COLUMN "resolutionAction" VARCHAR(32),
  ADD COLUMN "resolutionNote" VARCHAR(500),
  ADD COLUMN "resolvedAt" TIMESTAMP(3);

CREATE TABLE "order_messages" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "authorId" TEXT,
  "authorRole" "MessageRole" NOT NULL,
  "text" VARCHAR(1000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_messages_orderId_createdAt_idx" ON "order_messages"("orderId", "createdAt");

ALTER TABLE "order_messages" ADD CONSTRAINT "order_messages_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_messages" ADD CONSTRAINT "order_messages_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
