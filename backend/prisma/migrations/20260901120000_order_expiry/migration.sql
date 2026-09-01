-- An unanswered order used to sit on the board forever. With a hundred of them
-- the live ones drown. 30 days by default; 0 turns it off.
ALTER TABLE "platform_settings"
  ADD COLUMN "order_expiry_days" INTEGER NOT NULL DEFAULT 30;
