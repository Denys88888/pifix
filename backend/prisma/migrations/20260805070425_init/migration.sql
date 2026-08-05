-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "EscrowStatus" AS ENUM ('NONE', 'FUNDED', 'RELEASED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ResponseStatus" AS ENUM ('ACTIVE', 'SELECTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('CONNECT', 'ESCROW', 'BOOST', 'SUBSCRIPTION', 'PAYOUT', 'WITHDRAWAL', 'REFERRAL_BONUS', 'REFUND');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'COMPLETED', 'CANCELLED', 'ERROR');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('U2A', 'A2U');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CONNECT_SPENT', 'ESCROW_FUNDED', 'ESCROW_RELEASED', 'ESCROW_REFUNDED', 'CONNECT_REFUNDED', 'JOB_EARNING', 'REFERRAL_BONUS', 'WITHDRAWAL', 'BOOST', 'SUBSCRIPTION', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewRole" AS ENUM ('CLIENT_TO_MASTER', 'MASTER_TO_CLIENT');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "piUid" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "walletAddress" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "isMaster" BOOLEAN NOT NULL DEFAULT false,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "kycVerified" BOOLEAN NOT NULL DEFAULT false,
    "ratingAvg" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "balancePi" DECIMAL(15,7) NOT NULL DEFAULT 0,
    "totalEarnedPi" DECIMAL(15,7) NOT NULL DEFAULT 0,
    "referrerId" TEXT,
    "referralBonusPaid" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '🛠️',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "bio" VARCHAR(1000) NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "address" VARCHAR(300),
    "radiusKm" INTEGER NOT NULL DEFAULT 20,
    "portfolio" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "certificates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verificationDocs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "verificationNote" VARCHAR(500),
    "verifiedAt" TIMESTAMP(3),
    "completedJobs" INTEGER NOT NULL DEFAULT 0,
    "boostedUntil" TIMESTAMP(3),
    "proUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_categories" (
    "masterProfileId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "master_categories_pkey" PRIMARY KEY ("masterProfileId","categoryId")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "budgetPi" DECIMAL(15,7) NOT NULL,
    "address" VARCHAR(300) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "OrderStatus" NOT NULL DEFAULT 'OPEN',
    "masterId" TEXT,
    "selectedResponseId" TEXT,
    "escrowStatus" "EscrowStatus" NOT NULL DEFAULT 'NONE',
    "escrowAmountPi" DECIMAL(15,7) NOT NULL DEFAULT 0,
    "clientFeePi" DECIMAL(15,7) NOT NULL DEFAULT 0,
    "expressFeePi" DECIMAL(15,7) NOT NULL DEFAULT 0,
    "totalPaidPi" DECIMAL(15,7) NOT NULL DEFAULT 0,
    "masterFeePi" DECIMAL(15,7) NOT NULL DEFAULT 0,
    "masterPayoutPi" DECIMAL(15,7) NOT NULL DEFAULT 0,
    "escrowPaymentId" TEXT,
    "autoReleaseAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "disputeReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "responses" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "masterId" TEXT NOT NULL,
    "pricePi" DECIMAL(15,7) NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "status" "ResponseStatus" NOT NULL DEFAULT 'ACTIVE',
    "connectPaymentId" TEXT,
    "connectPricePi" DECIMAL(15,7) NOT NULL DEFAULT 0,
    "connectRefunded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "piPaymentId" TEXT NOT NULL,
    "txid" TEXT,
    "userId" TEXT NOT NULL,
    "type" "PaymentType" NOT NULL,
    "direction" "PaymentDirection" NOT NULL DEFAULT 'U2A',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amountPi" DECIMAL(15,7) NOT NULL,
    "memo" VARCHAR(200) NOT NULL,
    "orderId" TEXT,
    "responseId" TEXT,
    "metadata" JSONB,
    "errorText" VARCHAR(500),
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amountPi" DECIMAL(15,7) NOT NULL,
    "balanceAfter" DECIMAL(15,7) NOT NULL DEFAULT 0,
    "description" VARCHAR(300) NOT NULL,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountPi" DECIMAL(15,7) NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
    "txid" TEXT,
    "piPaymentId" TEXT,
    "adminNote" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "role" "ReviewRole" NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" VARCHAR(500) NOT NULL DEFAULT '',
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "connect_price_pi" DECIMAL(15,7) NOT NULL DEFAULT 0.5,
    "client_fee_percent" DECIMAL(5,2) NOT NULL DEFAULT 10.0,
    "master_fee_percent" DECIMAL(5,2) NOT NULL DEFAULT 0.0,
    "pro_subscription_price_pi" DECIMAL(15,7) NOT NULL DEFAULT 10.0,
    "express_fee_pi" DECIMAL(15,7) NOT NULL DEFAULT 3.0,
    "profile_boost_price_pi" DECIMAL(15,7) NOT NULL DEFAULT 5.0,
    "escrow_timeout_days" INTEGER NOT NULL DEFAULT 7,
    "referral_bonus_direct_pi" DECIMAL(15,7) NOT NULL DEFAULT 1.0,
    "referral_bonus_indirect_pi" DECIMAL(15,7) NOT NULL DEFAULT 0.5,
    "min_budget_pi" DECIMAL(15,7) NOT NULL DEFAULT 1.0,
    "max_open_orders_per_client" INTEGER NOT NULL DEFAULT 5,
    "max_active_responses_per_master" INTEGER NOT NULL DEFAULT 10,
    "connect_refund_window_minutes" INTEGER NOT NULL DEFAULT 60,
    "min_withdrawal_pi" DECIMAL(15,7) NOT NULL DEFAULT 5.0,
    "auto_withdrawal_pi" DECIMAL(15,7) NOT NULL DEFAULT 0,
    "pi_usd_rate" DECIMAL(15,7) NOT NULL DEFAULT 0,
    "maintenance_mode" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_logs" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_state" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_state_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_piUid_key" ON "users"("piUid");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_referrerId_idx" ON "users"("referrerId");

-- CreateIndex
CREATE INDEX "users_isMaster_isBlocked_idx" ON "users"("isMaster", "isBlocked");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "master_profiles_userId_key" ON "master_profiles"("userId");

-- CreateIndex
CREATE INDEX "master_profiles_verificationStatus_idx" ON "master_profiles"("verificationStatus");

-- CreateIndex
CREATE INDEX "master_profiles_lat_lng_idx" ON "master_profiles"("lat", "lng");

-- CreateIndex
CREATE INDEX "master_categories_categoryId_idx" ON "master_categories"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_publicId_key" ON "orders"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_selectedResponseId_key" ON "orders"("selectedResponseId");

-- CreateIndex
CREATE INDEX "orders_status_categoryId_idx" ON "orders"("status", "categoryId");

-- CreateIndex
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt");

-- CreateIndex
CREATE INDEX "orders_lat_lng_idx" ON "orders"("lat", "lng");

-- CreateIndex
CREATE INDEX "orders_clientId_status_idx" ON "orders"("clientId", "status");

-- CreateIndex
CREATE INDEX "orders_masterId_status_idx" ON "orders"("masterId", "status");

-- CreateIndex
CREATE INDEX "orders_escrowStatus_autoReleaseAt_idx" ON "orders"("escrowStatus", "autoReleaseAt");

-- CreateIndex
CREATE INDEX "responses_masterId_status_idx" ON "responses"("masterId", "status");

-- CreateIndex
CREATE INDEX "responses_orderId_status_idx" ON "responses"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "responses_orderId_masterId_key" ON "responses"("orderId", "masterId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_piPaymentId_key" ON "payments"("piPaymentId");

-- CreateIndex
CREATE INDEX "payments_userId_status_idx" ON "payments"("userId", "status");

-- CreateIndex
CREATE INDEX "payments_type_status_idx" ON "payments"("type", "status");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- CreateIndex
CREATE INDEX "transactions_userId_createdAt_idx" ON "transactions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_type_createdAt_idx" ON "transactions"("type", "createdAt");

-- CreateIndex
CREATE INDEX "withdrawal_requests_status_createdAt_idx" ON "withdrawal_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "withdrawal_requests_userId_createdAt_idx" ON "withdrawal_requests"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "reviews_targetId_isHidden_createdAt_idx" ON "reviews"("targetId", "isHidden", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_orderId_authorId_key" ON "reviews"("orderId", "authorId");

-- CreateIndex
CREATE INDEX "admin_logs_createdAt_idx" ON "admin_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_profiles" ADD CONSTRAINT "master_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_categories" ADD CONSTRAINT "master_categories_masterProfileId_fkey" FOREIGN KEY ("masterProfileId") REFERENCES "master_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_categories" ADD CONSTRAINT "master_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responses" ADD CONSTRAINT "responses_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responses" ADD CONSTRAINT "responses_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
