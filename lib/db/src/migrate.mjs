import pg from "pg";

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const client = new Client({ connectionString: process.env.DATABASE_URL });

await client.connect();

try {
  await client.query("BEGIN");

  await client.query(`
    CREATE TABLE IF NOT EXISTS "bot_gambling_settings" (
      "guild_id" text PRIMARY KEY NOT NULL,
      "channel_id" text NOT NULL,
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await client.query("SELECT to_regclass('public.bot_game_settings') AS table_name");
  if (rows[0]?.table_name) {
    await client.query('ALTER TABLE "bot_game_settings" ADD COLUMN IF NOT EXISTS "game_type" text');
    await client.query('ALTER TABLE "bot_game_settings" ADD COLUMN IF NOT EXISTS "interval_minutes" integer DEFAULT 30');
    await client.query('ALTER TABLE "bot_game_settings" ADD COLUMN IF NOT EXISTS "reward" integer DEFAULT 100');
    await client.query('ALTER TABLE "bot_game_settings" ADD COLUMN IF NOT EXISTS "enabled" boolean DEFAULT false');
    await client.query('ALTER TABLE "bot_game_settings" ADD COLUMN IF NOT EXISTS "next_game_at" bigint DEFAULT 0');

    await client.query('UPDATE "bot_game_settings" SET "game_type" = \'legacy\' WHERE "game_type" IS NULL');
    await client.query('UPDATE "bot_game_settings" SET "interval_minutes" = 30 WHERE "interval_minutes" IS NULL');
    await client.query('UPDATE "bot_game_settings" SET "reward" = 100 WHERE "reward" IS NULL');
    await client.query('UPDATE "bot_game_settings" SET "enabled" = false WHERE "enabled" IS NULL');
    await client.query('UPDATE "bot_game_settings" SET "next_game_at" = 0 WHERE "next_game_at" IS NULL');

    await client.query(`
      WITH duplicate_game_types AS (
        SELECT ctid,
               row_number() OVER (PARTITION BY "guild_id", "game_type" ORDER BY ctid) AS duplicate_number
        FROM "bot_game_settings"
      )
      UPDATE "bot_game_settings" AS settings
      SET "game_type" = settings."game_type" || '-legacy-' || duplicate_game_types.duplicate_number
      FROM duplicate_game_types
      WHERE settings.ctid = duplicate_game_types.ctid
        AND duplicate_game_types.duplicate_number > 1
    `);

    await client.query('ALTER TABLE "bot_game_settings" ALTER COLUMN "game_type" SET NOT NULL');
    await client.query('ALTER TABLE "bot_game_settings" ALTER COLUMN "interval_minutes" SET DEFAULT 30');
    await client.query('ALTER TABLE "bot_game_settings" ALTER COLUMN "interval_minutes" SET NOT NULL');
    await client.query('ALTER TABLE "bot_game_settings" ALTER COLUMN "reward" SET DEFAULT 100');
    await client.query('ALTER TABLE "bot_game_settings" ALTER COLUMN "reward" SET NOT NULL');
    await client.query('ALTER TABLE "bot_game_settings" ALTER COLUMN "enabled" SET DEFAULT false');
    await client.query('ALTER TABLE "bot_game_settings" ALTER COLUMN "enabled" SET NOT NULL');
    await client.query('ALTER TABLE "bot_game_settings" ALTER COLUMN "next_game_at" SET DEFAULT 0');
    await client.query('ALTER TABLE "bot_game_settings" ALTER COLUMN "next_game_at" SET NOT NULL');

    await client.query(`
      DO $$
      DECLARE primary_key_name text;
      BEGIN
        SELECT constraint_name
        INTO primary_key_name
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'bot_game_settings'
          AND constraint_type = 'PRIMARY KEY';

        IF primary_key_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE "bot_game_settings" DROP CONSTRAINT %I', primary_key_name);
        END IF;
      END $$;
    `);
    await client.query('ALTER TABLE "bot_game_settings" ADD CONSTRAINT "bot_game_settings_pkey" PRIMARY KEY ("guild_id", "game_type")');

    const { rows: columns } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'bot_game_settings'
        AND column_name = ANY($1::text[])
    `, [["guild_id", "game_type", "channel_id", "interval_minutes", "reward", "enabled", "next_game_at", "updated_at"]]);
    const expectedColumns = ["guild_id", "game_type", "channel_id", "interval_minutes", "reward", "enabled", "next_game_at", "updated_at"];
    const actualColumns = new Set(columns.map(({ column_name }) => column_name));
    const missingColumns = expectedColumns.filter((column) => !actualColumns.has(column));
    if (missingColumns.length > 0) {
      throw new Error(`bot_game_settings migration incomplete; missing columns: ${missingColumns.join(", ")}`);
    }
  }

  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}