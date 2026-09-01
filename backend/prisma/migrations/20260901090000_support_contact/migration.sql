-- Somewhere for a pioneer to write when something goes wrong. Empty by default:
-- an unattended address is worse than none, so the app hides the block until
-- an operator fills this in from the admin panel.
ALTER TABLE "platform_settings"
  ADD COLUMN "support_contact" VARCHAR(200) NOT NULL DEFAULT '';
