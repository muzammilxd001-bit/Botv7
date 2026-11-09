import { randomInt, randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type Message,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { botMiningProfilesTable, db } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireGamblingChannel } from "./gamblingChannel";

const BOARD_SIZE = 24;
const BOARD_ROWS = 5;
const BOARD_COLUMNS = 5;
const DEFAULT_MINES = 3;
const MIN_MINES = 1;
const MAX_MINES = BOARD_SIZE - 1;
const MIN_BET = 1;
const MAX_BET = 250_000;
const MAX_CREDIT_BALANCE = 2_147_483_647;
const MINES_GAME_TIMEOUT_MS = 2 * 60_000;
const MINES_RETURN_RATE = 0.97;
const CREDITS_EMOJI = "<:16:1553581538074038372>";

interface MinesGame {
  id: string;
  guildId: string;
  userId: string;
  bet: number;
  mineCount: number;
  mines: Set<number>;
  revealed: Set<number>;
  message?: Message;
  stopCollector?: () => void;
  finished: boolean;
  busy: boolean;
  expired: boolean;
}

const activeGames = new Map<string, MinesGame>();

function gameKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!/^\d+$/.test(value ?? "")) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function selectMines(count: number): Set<number> {
  const mines = new Set<number>();
  while (mines.size < count) mines.add(randomInt(BOARD_SIZE));
  return mines;
}

function calculatePayout(game: MinesGame): number {
  let multiplier = 1;
  const opened = game.revealed.size;
  for (let index = 0; index < opened; index++) {
    multiplier *= (BOARD_SIZE - index) / (BOARD_SIZE - game.mineCount - index);
  }
  return Math.floor(game.bet * multiplier * MINES_RETURN_RATE);
}

function boardComponents(game: MinesGame, disabled = false, revealAll = false): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let rowIndex = 0; rowIndex < BOARD_ROWS; rowIndex++) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (let columnIndex = 0; columnIndex < BOARD_COLUMNS; columnIndex++) {
      const tile = rowIndex * BOARD_COLUMNS + columnIndex;
      if (tile === BOARD_SIZE) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`mines:${game.id}:cashout`)
            .setLabel("Cash out")
            .setStyle(ButtonStyle.Success)
            .setDisabled(disabled || game.revealed.size === 0),
        );
        continue;
      }

      const revealed = game.revealed.has(tile) || revealAll;
      const mined = game.mines.has(tile);
      const button = new ButtonBuilder()
        .setCustomId(`mines:${game.id}:tile:${tile}`)
        .setDisabled(disabled || revealed);

      if (revealed && mined) {
        button.setEmoji("💣").setStyle(ButtonStyle.Danger);
      } else if (revealed) {
        button.setEmoji("💎").setStyle(ButtonStyle.Success);
      } else {
        button.setLabel(String(tile + 1)).setStyle(ButtonStyle.Secondary);
      }

      row.addComponents(button);
    }

    rows.push(row);
  }
  return rows;
}

function gameContent(game: MinesGame, status?: string): string {
  const payout = game.revealed.size > 0 ? calculatePayout(game) : 0;
  const progress = game.revealed.size > 0
    ? `\nSafe tiles: **${game.revealed.size}** • Cash-out: **${CREDITS_EMOJI} ${payout.toLocaleString()}**`
    : "";
  return `<@${game.userId}> wagered **${CREDITS_EMOJI} ${game.bet.toLocaleString()}** with **${game.mineCount} mines**. Pick a tile or use the button below to cash out.${progress}${status ? `\n${status}` : ""}`;
}

async function settleWager(game: MinesGame, requestedPayout: number): Promise<number> {
  return db.transaction(async (tx) => {
    const [profile] = await tx.select({ coins: botMiningProfilesTable.coins })
      .from(botMiningProfilesTable)
      .where(and(
        eq(botMiningProfilesTable.guildId, game.guildId),
        eq(botMiningProfilesTable.userId, game.userId),
      ))
      .for("update");
    if (!profile) throw new Error("Could not load Mines credit profile for settlement");

    const payout = Math.min(requestedPayout, MAX_CREDIT_BALANCE - profile.coins);
    await tx.update(botMiningProfilesTable)
      .set({ coins: profile.coins + payout, updatedAt: new Date() })
      .where(and(
        eq(botMiningProfilesTable.guildId, game.guildId),
        eq(botMiningProfilesTable.userId, game.userId),
      ));
    return payout;
  });
}

async function finishGame(game: MinesGame, status: string, revealAll = true): Promise<void> {
  game.finished = true;
  activeGames.delete(gameKey(game.guildId, game.userId));
  try {
    await game.message?.edit({
      content: gameContent(game, status),
      components: boardComponents(game, true, revealAll),
    });
  } finally {
    game.stopCollector?.();
  }
}

async function cashOutGame(game: MinesGame): Promise<number> {
  if (game.finished) throw new Error("Cannot cash out a completed Mines game");
  if (game.busy) throw new Error("Mines game is currently processing another move");
  game.busy = true;
  try {
    const requestedPayout = game.revealed.size > 0 ? calculatePayout(game) : game.bet;
    const payout = await settleWager(game, requestedPayout);
    await finishGame(game, `✅ Cashed out **${CREDITS_EMOJI} ${payout.toLocaleString()} credits**.`);
    return payout;
  } finally {
    game.busy = false;
  }
}

async function expireGame(game: MinesGame): Promise<void> {
  if (game.finished || game.busy) return;
  game.busy = true;
  const payout = game.revealed.size > 0 ? calculatePayout(game) : game.bet;
  try {
    const settledPayout = await settleWager(game, payout);
    await finishGame(game, `⌛ Game expired. Auto-cashed out **${CREDITS_EMOJI} ${settledPayout.toLocaleString()} credits**.`);
  } finally {
    game.busy = false;
  }
}

async function handleMinesInteraction(game: MinesGame, interaction: ButtonInteraction): Promise<void> {
  if (interaction.user.id !== game.userId) {
    await interaction.reply({ content: "This Mines board belongs to another player.", ephemeral: true });
    return;
  }
  if (game.finished || game.busy) {
    await interaction.reply({ content: "This Mines game is already being updated.", ephemeral: true });
    return;
  }

  game.busy = true;
  try {
    await interaction.deferUpdate();
    const action = interaction.customId.slice(`mines:${game.id}:`.length);
    if (action === "cashout") {
      const requestedPayout = game.revealed.size > 0 ? calculatePayout(game) : game.bet;
      const payout = await settleWager(game, requestedPayout);
      await finishGame(game, `✅ Cashed out **${CREDITS_EMOJI} ${payout.toLocaleString()} credits**.`);
      return;
    }

    if (game.revealed.size === BOARD_SIZE - game.mineCount) {
      const payout = await settleWager(game, calculatePayout(game));
      await finishGame(game, `🎉 You cleared every safe tile and won **${CREDITS_EMOJI} ${payout.toLocaleString()} credits**.`);
      return;
    }
    const tile = Number(action.slice("tile:".length));
    if (!Number.isInteger(tile) || tile < 0 || tile >= BOARD_SIZE || game.revealed.has(tile)) return;

    if (game.mines.has(tile)) {
      await finishGame(game, "💥 You hit a mine and lost your wager.", true);
      return;
    }

    game.revealed.add(tile);
    if (game.revealed.size === BOARD_SIZE - game.mineCount) {
      const payout = await settleWager(game, calculatePayout(game));
      await finishGame(game, `🎉 You cleared every safe tile and won **${CREDITS_EMOJI} ${payout.toLocaleString()} credits**.`);
      return;
    }

    const gameMessage = game.message;
    if (!gameMessage) throw new Error("Mines game message is unavailable");
    await gameMessage.edit({
      content: gameContent(game),
      components: boardComponents(game),
    });
  } finally {
    game.busy = false;
    if (game.expired && !game.finished) await expireGame(game);
  }
}

export async function handleMinesCommand(message: Message, args: string[] = message.content.trim().split(/\s+/).slice(1)): Promise<void> {
  const guild = message.guild;
  if (!guild) return;

  if (args[0]?.toLowerCase() === "help") {
    await message.reply("Usage: `!mines <bet> [mine-count]` — play a 5×5 board with 1–23 mines (default 3). Open safe tiles to raise your cash-out; use the board's Cash out button or `!mines cashout` to collect, or hit a mine and lose your wager. Bets: 1–250,000 credits.");
    return;
  }

  if (!(await requireGamblingChannel(message))) return;
  const key = gameKey(guild.id, message.author.id);
  const activeGame = activeGames.get(key);
  if (args[0]?.toLowerCase() === "cashout") {
    if (!activeGame) {
      await message.reply("You don't have an active Mines game to cash out.");
      return;
    }
    await cashOutGame(activeGame);
    return;
  }

  const bet = parsePositiveInteger(args[0]);
  const mineCount = args[1] === undefined ? DEFAULT_MINES : parsePositiveInteger(args[1]);
  if (bet === null || bet < MIN_BET || bet > MAX_BET || mineCount === null || mineCount < MIN_MINES || mineCount > MAX_MINES) {
    await message.reply(`Usage: \`!mines <bet> [mine-count]\` (bet: ${MIN_BET.toLocaleString()}–${MAX_BET.toLocaleString()}, mines: ${MIN_MINES}–${MAX_MINES}; default ${DEFAULT_MINES}).`);
    return;
  }
  if (activeGame) {
    await message.reply("You already have an active Mines game. Finish it before starting another.");
    return;
  }
  const game: MinesGame = {
    id: randomUUID(),
    guildId: guild.id,
    userId: message.author.id,
    bet,
    mineCount,
    mines: selectMines(mineCount),
    revealed: new Set(),
    finished: false,
    busy: false,
    expired: false,
  };
  activeGames.set(key, game);

  try {
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
      if (!profile) throw new Error("Could not load Mines credit profile");
      if (profile.coins < bet) return { status: "insufficient" as const, balance: profile.coins };

      await tx.update(botMiningProfilesTable)
        .set({ coins: profile.coins - bet, updatedAt: new Date() })
        .where(and(
          eq(botMiningProfilesTable.guildId, guild.id),
          eq(botMiningProfilesTable.userId, message.author.id),
        ));
      return { status: "started" as const };
    });

    if (result.status === "insufficient") {
      activeGames.delete(key);
      await message.reply(`You only have **${result.balance.toLocaleString()} credits** to wager.`);
      return;
    }

    try {
      game.message = await message.reply({
        content: gameContent(game),
        components: boardComponents(game),
      });
    } catch (error) {
      await settleWager(game, bet);
      throw error;
    }

    if (!game.message) throw new Error("Mines game message was not created");
    const collector = game.message.createMessageComponentCollector({
      time: MINES_GAME_TIMEOUT_MS,
      filter: (interaction) => interaction.customId.startsWith(`mines:${game.id}:`),
    });
    game.stopCollector = () => collector.stop("finished");
    collector.on("collect", (interaction) => {
      if (!interaction.isButton()) {
        void interaction.reply({ content: "Invalid Mines action.", ephemeral: true }).catch(() => {});
        return;
      }
      void handleMinesInteraction(game, interaction).catch(async (error: unknown) => {
        logger.error({ err: error, guildId: game.guildId, userId: game.userId }, "Could not process Mines interaction");
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "Could not process that Mines move. Please try again.", ephemeral: true }).catch(() => {});
        }
      });
    });
    collector.on("end", (collected, reason) => {
      if (reason !== "time" || game.finished) return;
      game.expired = true;
      void expireGame(game).catch((error: unknown) => {
        logger.error({ err: error, guildId: game.guildId, userId: game.userId, collected: collected.size }, "Could not settle expired Mines game");
      });
    });
  } catch (error) {
    activeGames.delete(key);
    throw error;
  }
}
