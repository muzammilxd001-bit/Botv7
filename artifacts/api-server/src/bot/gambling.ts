import { randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { type Message } from "discord.js";
import { botMiningProfilesTable, db } from "@workspace/db";
import { logger } from "../lib/logger";

const MIN_BET = 1;
const MAX_BET = 250_000;
const MAX_BALANCE = 2_147_483_647;
const COINFLIP_EMOJI = "<a:coinflip:1567512384338133093>";
const HEADS_EMOJI = "<:heads:1567519192230400010>";
const TAILS_EMOJI = "<:tails:1567519233418465380>";
const CREDITS_EMOJI = "<:16:1553581538074038372>";
const COINFLIP_DELAY_MS = 1_500;
const GAMBLING_COOLDOWN_MS = 15_000;
const gamblingCooldowns = new Map<string, number>();

type CoinSide = "heads" | "tails";

function parseSide(value: string | undefined): CoinSide | null {
  const side = value?.toLowerCase();
  if (side === "heads" || side === "head" || side === "h") return "heads";
  if (side === "tails" || side === "tail" || side === "t") return "tails";
  return null;
}

function parseBet(value: string | undefined): number {
  if (!/^\d+$/.test(value ?? "")) return NaN;
  const bet = Number(value);
  return Number.isSafeInteger(bet) && bet >= MIN_BET && bet <= MAX_BET ? bet : NaN;
}

export async function handleCoinflipCommand(message: Message, args: string[] = message.content.trim().split(/\s+/).slice(1)): Promise<void> {
  const guild = message.guild;
  if (!guild) return;

  const [first, second] = args;
  const allIn = first?.toLowerCase() === "all";
  const parsedBet = parseBet(first) || parseBet(second);
  const side = parseSide(first) ?? parseSide(second) ?? (allIn || Number.isSafeInteger(parsedBet)
    ? (randomInt(2) === 0 ? "heads" : "tails")
    : null);
  if (!side || (!allIn && !Number.isSafeInteger(parsedBet))) {
    await message.reply(`Usage: \`!coinflip <heads|tails> <bet>\`, \`!cf <bet> <h|t>\`, \`!cf <bet>\`, \`!cf all\`, or \`!cf all <h|t>\` (bet: ${MIN_BET.toLocaleString()}–${MAX_BET.toLocaleString()} credits).`);
    return;
  }

  const cooldownKey = `${guild.id}:${message.author.id}`;
  const now = Date.now();
  const cooldownUntil = gamblingCooldowns.get(cooldownKey) ?? 0;
  if (cooldownUntil > now) {
    const nickname = message.member?.displayName ?? message.author.displayName;
    await message.reply(`⏱ | ${nickname}! Slow down and try the command again <t:${Math.ceil(cooldownUntil / 1000)}:R>`);
    return;
  }
  gamblingCooldowns.set(cooldownKey, now + GAMBLING_COOLDOWN_MS);

  const result = await db.transaction(async (tx) => {
    await tx.insert(botMiningProfilesTable)
      .values({ guildId: guild.id, userId: message.author.id })
      .onConflictDoNothing();
    const [profile] = await tx.select({ coins: botMiningProfilesTable.coins })
      .from(botMiningProfilesTable)
      .where(and(
        eq(botMiningProfilesTable.guildId, guild.id),
        eq(botMiningProfilesTable.userId, message.author.id),
      ))
      .for("update");
    if (!profile) throw new Error("Could not load gambling credit profile");
    const bet = allIn ? profile.coins : parsedBet;
    if (!Number.isSafeInteger(bet) || bet < MIN_BET || profile.coins < bet) {
      return { status: "insufficient" as const, balance: profile.coins, bet: bet ?? 0 };
    }

    const landed = randomInt(2) === 0 ? "heads" : "tails";
    const won = landed === side;
    const balance = won ? profile.coins + bet : profile.coins - bet;
    if (balance > MAX_BALANCE) return { status: "maximum" as const };

    await tx.update(botMiningProfilesTable)
      .set({ coins: balance, updatedAt: new Date() })
      .where(and(
        eq(botMiningProfilesTable.guildId, guild.id),
        eq(botMiningProfilesTable.userId, message.author.id),
      ));
    return { status: "played" as const, landed, won, balance, bet };
  });

  if (result.status === "insufficient") {
    await message.reply(`You only have **${result.balance.toLocaleString()} credits** to bet.`);
    return;
  }
  if (result.status === "maximum") {
    await message.reply("That win would exceed the maximum credit balance.");
    return;
  }

  const chosenSide = side === "heads" ? "heads" : "tails";
  const resultMessage = await message.reply(
    `**${message.author.displayName}** spent **${CREDITS_EMOJI} ${result.bet.toLocaleString()}** and chose **${chosenSide}**`,
  );
  await new Promise((resolve) => setTimeout(resolve, COINFLIP_DELAY_MS));
  const landedEmoji = result.landed === "heads" ? HEADS_EMOJI : TAILS_EMOJI;
  await resultMessage.edit(
    result.won
        ? `${COINFLIP_EMOJI} The coin spins... ${landedEmoji} and you won **${CREDITS_EMOJI} ${(result.bet * 2).toLocaleString()}**!`
        : `${COINFLIP_EMOJI} The coin spins... ${landedEmoji} and you lost it all... :c`,
  );
}

export async function handleGambleCommand(message: Message, args: string[]): Promise<void> {
  const game = args[0]?.toLowerCase();
  if (game === "coinflip" || game === "flip") {
    await handleCoinflipCommand(message, args.slice(1));
    return;
  }
  await message.reply("Usage: `!gamble coinflip <heads|tails> <bet>` or `!coinflip <heads|tails> <bet>`.");
}

export function logGamblingError(error: unknown, guildId?: string, userId?: string): void {
  logger.error({ err: error, guildId, userId }, "Could not process gambling command");
}
