import {
  type Message,
  type Client,
  type TextChannel,
  PermissionFlagsBits,
} from "discord.js";
import { handleAfk } from "./afk";
import { handleWarn, handleWarnings, handleClearWarnings } from "./warn";
import { handleMute, handleUnmute } from "./mute";
import { handleWordbomb, handleWordbombStop, handleWbTop } from "./wordbomb";
import { handlePurge, handlePurgeBot } from "./purge";
import { hasNoPrefix, handleNoPrefix } from "./noprefix";
import { handleHelp } from "./help";
import { startGiveaway, endGiveaway, rerollGiveaway, parseDuration } from "./giveaway";
import { handleKick, handleBan, handleUnban, handleNuke, handleSlowmode, handleLock, handleUnlock, handleHide, handleUnhide } from "./moderation";
import {
  handleUserInfo,
  handleServerInfo,
  handleAvatar,
  handleRole,
  handleNick,
  handleAnnounce,
  handleMemberCount,
  handlePing,
  handleBotInfo,
  handleChannelInfo,
  handleQuote,
  handleRoleInfo,
  handleBanner,
  handleSnipe,
} from "./utility";
import { handleBumpCommand, handleReminderCommand, handleTimerCommand } from "./reminders";
import { handleShip, handleSocialAction, SOCIAL_ACTIONS, type SocialActionName } from "./social";
import { handleSteal } from "./steal";
import { handleAutoModeration, handleAutomodCommand } from "./moderation";
import {
  handleAutoResponderCommand,
  handleAutoReactCommand,
  handleStickyCommand,
  handleWelcomeCommand,
  handleBoostMessageCommand,
  handleGoodbyeCommand,
  handleSetGreetingCommand,
} from "./automation-commands";
import { withPremiumReplies } from "./presentation";
import { handleJtcCommand, handleVcCommand } from "./joinToCreate";
import { handleTicketCommand } from "./tickets";
import { handleSocialRoleCommand } from "./socialRole";
import { handleModerationRoleCommand } from "./moderationRole";
import { handleModerationLimitCommand } from "./moderationLimits";
import { handleSetGameCommand } from "./gameChannel";
import { handleQuoteRoleCommand, handleSetQuoteCommand } from "./quoteChannel";
import { handleCreditCommand, handleCreditLeaderboardCommand, handleCreditTransferCommand, handleRoleShopCommand } from "./roleShop";
import { awardChatCredits, handleActiveChatRewardChannelCommand } from "./credits";
import { handleCreditGameAnswer, handleCreditGameCommand } from "./games";
import { handleCreditDropCommand } from "./crates";
import { handleFlagDropAnswer, handleFlagDropCommand } from "./flagDrop";
import { handleEmbedCommand } from "./embeds";
import { handleStatusRoleCommand } from "./statusRole";
import { handleGuildTagRoleCommand } from "./guildTagRole";
import { handleAutoEmergencyCommand } from "./emergency";
import { handleCoinflipCommand, handleGambleCommand, logGamblingError } from "./gambling";
import { logger } from "../lib/logger";

const PREFIX = "!";

export async function handleMessage(
  client: Client,
  incomingMessage: Message,
  options: { skipAutoModeration?: boolean } = {},
): Promise<void> {
  if (incomingMessage.author.bot) return;
  const message = withPremiumReplies(incomingMessage, client.user);

  const raw = message.content.trim();
  if (!incomingMessage.guild) {
    const helpMatch = /^!help(?:\s+(\S+))?$/i.exec(raw);
    if (helpMatch) {
      await handleHelp(message, helpMatch[1]);
    }
    return;
  }

  if (!raw.startsWith("!")) {
    await handleCreditGameAnswer(message);
  }

  const noPrefix = hasNoPrefix(message);
  const content = (!raw.startsWith("!") && noPrefix) ? `!${raw}` : raw;

  if (!options.skipAutoModeration && await handleAutoModeration(message)) return;

  if (!content.startsWith("!")) {
    void awardChatCredits(message);
  }

  await handleAfk(message, content);

  if (!raw.startsWith("!")) {
    await handleFlagDropAnswer(message);
  }

  if (!content.startsWith("!") && !noPrefix) return;

  const lower = content.toLowerCase();

  if (lower === "!creditdrop" || lower.startsWith("!creditdrop ")) {
    await handleCreditDropCommand(message);
    return;
  }
  if (lower === "!flagdrop" || lower.startsWith("!flagdrop ")) {
    await handleFlagDropCommand(message);
    return;
  }
  if (lower === "!setchatreward" || lower.startsWith("!setchatreward ")) {
    await handleActiveChatRewardChannelCommand(message, content.split(/\s+/).slice(1));
    return;
  }
  if (lower === "!embed" || lower.startsWith("!embed ")) {
    await handleEmbedCommand(message);
    return;
  }
  if (lower === "!games" || lower.startsWith("!games ")) {
    await handleCreditGameCommand(message, content.split(/\s+/).slice(1));
    return;
  }
  if (lower === "!coinflip" || lower.startsWith("!coinflip ") || lower === "!cf" || lower.startsWith("!cf ")) {
    try {
      await handleCoinflipCommand(message, content.split(/\s+/).slice(1));
    } catch (error) {
      logGamblingError(error, incomingMessage.guild.id, message.author.id);
      await message.reply("❌ Could not process the coinflip right now. Please try again.");
    }
    return;
  }
  if (lower === "!gamble" || lower.startsWith("!gamble ")) {
    try {
      await handleGambleCommand(message, content.split(/\s+/).slice(1));
    } catch (error) {
      logGamblingError(error, incomingMessage.guild.id, message.author.id);
      await message.reply("❌ Could not process the gambling command right now. Please try again.");
    }
    return;
  }

  // ── Giveaway ──────────────────────────────────────────────────────────────
  if (lower === `!${PREFIX}start` || lower.startsWith(`!${PREFIX}start `)) {
    await handleGstart(client, message);
  } else if (lower === `!${PREFIX}end` || lower.startsWith(`!${PREFIX}end `)) {
    await handleGend(client, message);
  } else if (lower === `!${PREFIX}reroll` || lower.startsWith(`!${PREFIX}reroll `)) {
    await handleGreroll(client, message);

  // ── Help ──────────────────────────────────────────────────────────────────
  } else if (lower === `!${PREFIX}help` || lower.startsWith(`!${PREFIX}help `) || lower === "!help" || lower.startsWith("!help ")) {
    return;

  // ── Channel Automations ────────────────────────────────────────────────────
  } else if (lower === "!autoresponder" || lower.startsWith("!autoresponder ")) {
    await handleAutoResponderCommand(message);
  } else if (lower === "!autoreact" || lower.startsWith("!autoreact ")) {
    await handleAutoReactCommand(message);
  } else if (lower === "!sticky" || lower.startsWith("!sticky ")) {
    await handleStickyCommand(client, message);
  } else if (lower === "!welcome" || lower.startsWith("!welcome ")) {
    await handleWelcomeCommand(message, client);
  } else if (lower === "!goodbye" || lower.startsWith("!goodbye ")) {
    await handleGoodbyeCommand(message, client);
  } else if (/^!set\s+(welcome|boost|goodbye)\s+channel\b/i.test(message.content.trim())) {
    await handleSetGreetingCommand(message, client);
  } else if (lower === "!boost" || lower.startsWith("!boost ")) {
    await handleBoostMessageCommand(message, client);
  } else if (lower === "!reminder" || lower.startsWith("!reminder ")) {
    await handleReminderCommand(message);
  } else if (lower === "!timer" || lower.startsWith("!timer ")) {
    await handleTimerCommand(message);
  } else if (lower === "!bump" || lower.startsWith("!bump ")) {
    await handleBumpCommand(message);
  } else if (lower === "!statusrole" || lower.startsWith("!statusrole ")) {
    await handleStatusRoleCommand(message);
  } else if (lower === "!guildtagrole" || lower.startsWith("!guildtagrole ")) {
    await handleGuildTagRoleCommand(message);
  } else if (lower === "!auto emergency" || lower.startsWith("!auto emergency ")) {
    await handleAutoEmergencyCommand(message);
  // ── Moderation ────────────────────────────────────────────────────────────
  } else if (lower === "!automod" || lower.startsWith("!automod ")) {
    await handleAutomodCommand(message);
  } else if (lower === "!modrole" || lower.startsWith("!modrole ")) {
    await handleModerationRoleCommand(message, content.split(/\s+/).slice(1));
  } else if (lower === "!modlimit" || lower.startsWith("!modlimit ")) {
    await handleModerationLimitCommand(message, content.split(/\s+/).slice(1));
  } else if (lower === "!warn" || lower.startsWith("!warn ")) {
    await handleWarn(message);
  } else if (lower === "!warnings" || lower.startsWith("!warnings ")) {
    await handleWarnings(message);
  } else if (lower === "!clearwarnings" || lower.startsWith("!clearwarnings ") || lower === "!clearwarn" || lower.startsWith("!clearwarn ")) {
    await handleClearWarnings(message);
  } else if (lower === "!mute" || lower.startsWith("!mute ")) {
    await handleMute(message);
  } else if (lower === "!unmute" || lower.startsWith("!unmute ")) {
    await handleUnmute(message);
  } else if (lower === "!kick" || lower.startsWith("!kick ")) {
    await handleKick(message);
  } else if (lower === "!ban" || lower.startsWith("!ban ")) {
    await handleBan(message);
  } else if (lower === "!unban" || lower.startsWith("!unban ")) {
    await handleUnban(message);
  } else if (lower === "!nuke") {
    await handleNuke(message);
  } else if (lower === "!slowmode" || lower.startsWith("!slowmode ")) {
    await handleSlowmode(message);
  } else if (lower === "!lock") {
    await handleLock(message);
  } else if (lower === "!unlock") {
    await handleUnlock(message);
  } else if (lower === "!hide" || lower.startsWith("!hide ")) {
    await handleHide(message, content.split(/\s+/).slice(1));
  } else if (lower === "!unhide" || lower.startsWith("!unhide ")) {
    await handleUnhide(message, content.split(/\s+/).slice(1));
  } else if (lower.startsWith("!purge")) {
    await handlePurge(message);
  } else if (lower.startsWith("!pb")) {
    await handlePurgeBot(message);
  } else if (lower === "!noprefix" || lower.startsWith("!noprefix ")) {
    await handleNoPrefix(message);

  // ── Utility ───────────────────────────────────────────────────────────────
  } else if (lower === "!userinfo" || lower.startsWith("!userinfo ")) {
    await handleUserInfo(message);
  } else if (lower === "!roleinfo" || lower.startsWith("!roleinfo ")) {
    await handleRoleInfo(message);
  } else if (lower === "!serverinfo") {
    await handleServerInfo(message);
  } else if (lower === "!mc" || lower === "!membercount") {
    await handleMemberCount(message);
  } else if (lower === "!ping") {
    await handlePing(client, message);
  } else if (lower === "!botinfo") {
    await handleBotInfo(client, message);
  } else if (lower === "!channelinfo") {
    await handleChannelInfo(message);
  } else if (lower === "!avatar" || lower.startsWith("!avatar ")) {
    await handleAvatar(message);
  } else if (lower === "!banner" || lower.startsWith("!banner ")) {
    await handleBanner(message);
  } else if (lower === "!snipe") {
    await handleSnipe(message);
  } else if (lower === "!quote" || lower.startsWith("!quote ")) {
    await handleQuote(message);
  } else if (lower === "!setquote" || lower.startsWith("!setquote ")) {
    await handleSetQuoteCommand(message, content.split(/\s+/).slice(1));
  } else if (lower === "!quoterole" || lower.startsWith("!quoterole ")) {
    await handleQuoteRoleCommand(message, content.split(/\s+/).slice(1));
  } else if (lower === "!role" || lower.startsWith("!role ")) {
    await handleRole(message);
  } else if (lower === "!nick" || lower.startsWith("!nick ")) {
    await handleNick(message);
  } else if (lower === "!announce" || lower.startsWith("!announce ")) {
    await handleAnnounce(message);

  // ── Fun / Games ───────────────────────────────────────────────────────────
  } else if (lower === "!setgame" || lower.startsWith("!setgame ")) {
    await handleSetGameCommand(message, content.split(/\s+/).slice(1));
  } else if (lower === "!wordbomb" || lower === "!wb") {
    await handleWordbomb(client, message);
  } else if (lower === "!wbstop" || lower === "!wordbomb stop") {
    await handleWordbombStop(message);
  } else if (lower === "!wbtop") {
    await handleWbTop(message);
  } else if (lower === "!top credits" || lower === "!top credit" || lower === "!topcredits") {
    await handleCreditLeaderboardCommand(message);
  } else if (lower === "!transfer" || lower.startsWith("!transfer ") || lower === "!give" || lower.startsWith("!give ")) {
    await handleCreditTransferCommand(message);
  } else if (lower === "!credit" || lower.startsWith("!credit ") || lower === "!credits" || lower.startsWith("!credits ")) {
    await handleCreditCommand(message);
  } else if (lower === "!cash" || lower.startsWith("!cash ")) {
    await handleCreditCommand(message);
  } else if (lower === "!shop" || lower.startsWith("!shop ")) {
    const args = content.split(/\s+/).slice(1);
    await handleRoleShopCommand(message, args);
  } else if (lower === "!ship" || lower.startsWith("!ship ")) {
    await handleShip(message);
  } else if (lower === "!steal" || lower.startsWith("!steal ")) {
    await handleSteal(message);

  // ── Voice (Join to Create) ────────────────────────────────────────────────
  } else if (lower === "!voice" || lower.startsWith("!voice ")) {
    const args = content.split(/\s+/).slice(1);
    await handleVcCommand(message, args);
  } else if (lower === "!v" || lower.startsWith("!v ")) {
    const args = content.split(/\s+/).slice(1);
    await handleVcCommand(message, args);
  } else if (lower === "!vc" || lower.startsWith("!vc ")) {
    const args = content.split(/\s+/).slice(1);
    await handleVcCommand(message, args);
  } else if (lower === "!jtc" || lower.startsWith("!jtc ")) {
    const args = content.split(/\s+/).slice(1);
    await handleJtcCommand(message, args);
  } else if (lower === "!socialrole" || lower.startsWith("!socialrole ")) {
    const args = content.split(/\s+/).slice(1);
    await handleSocialRoleCommand(message, args);
  } else if (lower === "!ticket" || lower.startsWith("!ticket ")) {
    const args = content.split(/\s+/).slice(1);
    await handleTicketCommand(message, args);
  } else {
    const command = lower.match(/^!([a-z]+)(?:\s|$)/)?.[1] as SocialActionName | undefined;
    if (command && Object.hasOwn(SOCIAL_ACTIONS, command)) {
      await handleSocialAction(message, command);
    }
  }
}

// ─── Giveaway helpers ─────────────────────────────────────────────────────────

async function handleGstart(client: Client, message: Message): Promise<void> {
  const member = message.guild!.members.cache.get(message.author.id);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply("❌ You need the **Manage Server** permission to start giveaways.");
    return;
  }
  const args = message.content.trim().split(/\s+/).slice(1);
  if (args.length < 2) {
    await message.reply("❌ Usage: `!gstart <duration> [winners] <prize>`\nExample: `!gstart 1d 1 Nitro`\nDuration: `30s`, `5m`, `2h`, `1d`");
    return;
  }
  const duration = parseDuration(args[0]);
  if (!duration) {
    await message.reply("❌ Invalid duration. Use formats like `30s`, `5m`, `2h`, `1d`.");
    return;
  }
  let winnerCount = 1;
  let prizeStart = 1;
  if (args.length >= 3 && /^\d+$/.test(args[1])) {
    winnerCount = Math.max(1, Math.min(20, parseInt(args[1])));
    prizeStart = 2;
  }
  const prize = args.slice(prizeStart).join(" ");
  if (!prize) {
    await message.reply("❌ Please provide a prize name.");
    return;
  }
  const channel = message.channel as TextChannel;
  const result = await startGiveaway(client, channel, message.author.id, message.guild!.id, duration, prize, winnerCount);
  if (result.success) {
    await message.delete().catch(() => {});
  } else {
    await message.reply(`❌ ${result.message}`);
  }
}

async function handleGend(client: Client, message: Message): Promise<void> {
  const member = message.guild!.members.cache.get(message.author.id);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply("❌ You need the **Manage Server** permission to end giveaways.");
    return;
  }
  const args = message.content.trim().split(/\s+/).slice(1);
  if (!args[0]) {
    await message.reply("❌ Usage: `!gend <message_id>`");
    return;
  }
  const result = await endGiveaway(client, args[0]);
  if (!result.success) await message.reply(`❌ ${result.message}`);
}

async function handleGreroll(client: Client, message: Message): Promise<void> {
  const member = message.guild!.members.cache.get(message.author.id);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply("❌ You need the **Manage Server** permission to reroll giveaways.");
    return;
  }
  const args = message.content.trim().split(/\s+/).slice(1);
  if (!args[0]) {
    await message.reply("❌ Usage: `!greroll <message_id> [amount]`");
    return;
  }
  let winnerOverride: number | undefined;
  if (args[1]) {
    const n = parseInt(args[1]);
    if (isNaN(n) || n < 1 || n > 20) {
      await message.reply("❌ Amount must be a number between 1 and 20.");
      return;
    }
    winnerOverride = n;
  }
  const result = await rerollGiveaway(client, args[0], winnerOverride);
  if (!result.success) await message.reply(`❌ ${result.message}`);
}
