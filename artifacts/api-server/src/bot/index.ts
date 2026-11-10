import {
  Client,
  GatewayIntentBits,
  Partials,
  type MessageReaction,
  type User,
} from "discord.js";
import { handleMessage } from "./commands";
import { rememberDeletedMessage } from "./utility";
import { handleBumpMessage, startReminderScheduler } from "./reminders";
import { handleEmbedInteraction } from "./embeds";
import { handleSlashCommand, handleSocialAutocomplete, registerSlashCommands } from "./slash";
import { handleSocialBackButton } from "./social";
import { giveaways, buildGiveawayEmbed } from "./giveaway";
import { handleJtcInteraction, handleVoiceStateUpdate, startTempChannelCleanupScheduler } from "./joinToCreate";
import { handleTicketInteraction } from "./tickets";
import { logger } from "../lib/logger";
import { processUserMessageAutomations, sendMemberMessage } from "./automation";
import { handleCreditDropReaction, startCreditDropScheduler } from "./crates";
import { startFlagDropScheduler } from "./flagDrop";
import { handleGameAnswerInteraction, handleGameDropInteraction } from "./games";
import { handleStatusRolePresenceUpdate } from "./statusRole";
import { handleGuildTagRoleUserUpdate } from "./guildTagRole";
import {
  handleAutoEmergencyCommand,
  handleEmergencyBanAdd,
  handleEmergencyEveryonePing,
  handleEmergencyMemberRemove,
  handleEmergencyRoleUpdate,
} from "./emergency";

export function createBot(): Client {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    logger.error("DISCORD_BOT_TOKEN is not set. Bot will not start.");
    return new Client({ intents: [] });
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });
  client.once("clientReady", () => {
    logger.info({ tag: client.user?.tag }, "Discord bot is ready");
    client.user?.setActivity("🎉 Giveaways | !help | /help");
    startCreditDropScheduler(client);
    startFlagDropScheduler(client);
    startTempChannelCleanupScheduler(client);
    startReminderScheduler(client);
    void registerSlashCommands(client);
  });

  client.on("guildCreate", (guild) => {
    void registerSlashCommands(client).catch((err) => {
      logger.error({ err, guildId: guild.id }, "Failed to register commands for new guild");
    });
  });

  client.on("messageCreate", async (message) => {
    void handleBumpMessage(message).catch((err) => {
      logger.error({ err, guildId: message.guildId }, "Error handling bump message");
    });
    if (message.mentions.everyone) {
      void handleEmergencyEveryonePing(client, message).catch((err) => {
        logger.error({ err, guildId: message.guildId, userId: message.author.id }, "Error checking emergency @everyone threshold");
      });
    }
    try {
      await handleMessage(client, message);
    } catch (err) {
      logger.error({ err }, "Error handling message");
    } finally {
      await processUserMessageAutomations(client, message);
    }
  });

  client.on("messageDelete", (message) => {
    void rememberDeletedMessage(message).catch((err) => {
      logger.error({ err, guildId: message.guildId, channelId: message.channelId }, "Could not cache deleted message for snipe");
    });
  });

  client.on("guildMemberAdd", (member) => {
    void sendMemberMessage(client, member, "welcome").catch((err) => {
      logger.error({ err, guildId: member.guild.id }, "Could not send welcome message");
    });
  });

  client.on("guildMemberUpdate", (oldMember, newMember) => {
    if (oldMember.partial || oldMember.premiumSince || !newMember.premiumSince) return;
    void sendMemberMessage(client, newMember, "boost").catch((err) => {
      logger.error({ err, guildId: newMember.guild.id }, "Could not send boost message");
    });
  });

  client.on("guildBanAdd", (ban) => {
    void handleEmergencyBanAdd(client, ban).catch((err) => {
      logger.error({ err, guildId: ban.guild.id, userId: ban.user.id }, "Error checking emergency ban threshold");
    });
  });

  client.on("guildMemberRemove", (member) => {
    void handleEmergencyMemberRemove(client, member).catch((err) => {
      logger.error({ err, guildId: member.guild.id, userId: member.id }, "Error checking emergency kick threshold");
    });
  });

  client.on("guildRoleUpdate", (oldRole, newRole) => {
    void handleEmergencyRoleUpdate(oldRole, newRole).catch((err) => {
      logger.error({ err, guildId: newRole.guild.id, roleId: newRole.id }, "Error saving emergency role permissions");
    });
  });

  client.on("presenceUpdate", (oldPresence, newPresence) => {
    const presenceGuild = newPresence.guild;
    if (!presenceGuild) return;
    void handleStatusRolePresenceUpdate(oldPresence, newPresence).catch((err) => {
      logger.error({ err, guildId: presenceGuild.id, userId: newPresence.userId }, "Error handling status-role presence update");
    });
  });

  client.on("userUpdate", (oldUser, newUser) => {
    void handleGuildTagRoleUserUpdate(client, oldUser, newUser).catch((err) => {
      logger.error({ err, userId: newUser.id }, "Error handling guild-tag role update");
    });
  });

  client.on("voiceStateUpdate", (oldState, newState) => {
    void handleVoiceStateUpdate(client, oldState, newState).catch((err) => {
      logger.error({ err, guildId: newState.guild.id }, "Error handling voice state update");
    });
  });

  client.on("interactionCreate", async (interaction) => {
    if (
      (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) &&
      interaction.customId.startsWith("embed-ui:")
    ) {
      try {
        await handleEmbedInteraction(interaction);
      } catch (err) {
        logger.error({ err, customId: interaction.customId }, "Error handling embed builder interaction");
      }
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("social:back:")) {
      await handleSocialBackButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("games:answer:")) {
      try {
        await handleGameAnswerInteraction(interaction);
      } catch (err) {
        logger.error({ err, customId: interaction.customId }, "Error handling game answer");
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "Could not process that trivia answer.", ephemeral: true }).catch(() => {});
        }
      }
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("games:drop:")) {
      try {
        await handleGameDropInteraction(interaction);
      } catch (err) {
        logger.error({ err, customId: interaction.customId }, "Error handling game drop selection");
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "Could not process that game selection.", ephemeral: true }).catch(() => {});
        }
      }
      return;
    }
    if (interaction.isButton() && (interaction.customId === "ticket:open" || interaction.customId.startsWith("ticket:close:"))) {
      await handleTicketInteraction(interaction);
      return;
    }
    if (
      (interaction.isButton() || interaction.isModalSubmit()) &&
      interaction.customId.startsWith("jtc:")
    ) {
      try {
        await handleJtcInteraction(interaction);
      } catch (err) {
        logger.error({ err, customId: interaction.customId }, "Error handling join-to-create interaction");
      }
      return;
    }
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === "social") await handleSocialAutocomplete(interaction);
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    await handleSlashCommand(client, interaction);
  });

  client.on("messageReactionAdd", async (reaction: MessageReaction, user: User) => {
    try {
      if (user.bot) return;
      await handleCreditDropReaction(reaction, user);
      if (reaction.emoji.name !== "🎉") return;

      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();

      const giveaway = giveaways.get(reaction.message.id);
      if (!giveaway || giveaway.ended) return;

      giveaway.participants.add(user.id);

      await reaction.message.edit({
        embeds: [buildGiveawayEmbed(giveaway)],
      });
    } catch (err) {
      logger.error({ err }, "Error on reactionAdd");
    }
  });

  client.on("messageReactionRemove", async (reaction: MessageReaction, user: User) => {
    try {
      if (user.bot) return;
      if (reaction.emoji.name !== "🎉") return;

      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();

      const giveaway = giveaways.get(reaction.message.id);
      if (!giveaway || giveaway.ended) return;

      giveaway.participants.delete(user.id);

      await reaction.message.edit({
        embeds: [buildGiveawayEmbed(giveaway)],
      });
    } catch (err) {
      logger.error({ err }, "Error on reactionRemove");
    }
  });

  client.login(token).catch((err) => {
    logger.error({ err }, "Failed to login to Discord");
  });

  return client;
}
