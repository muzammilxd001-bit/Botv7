import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  Collection,
  GuildMember,
  Role,
  SlashCommandBuilder,
  User,
  ChannelType,
  type Message,
} from "discord.js";
import { handleMessage } from "./commands";
import { logger } from "../lib/logger";
import { SOCIAL_ACTION_NAMES } from "./social";
import { bumpStickyForChannel } from "./automation";
import { premiumEmbed } from "./presentation";
import { VC_HELP_TEXT } from "./joinToCreate";

const slashCommands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show the complete command help menu."),
  new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("Bet credits on a coin flip.")
    .addStringOption((o) => o.setName("side").setDescription("Heads or tails").setChoices(
      { name: "Heads", value: "heads" },
      { name: "Tails", value: "tails" },
    ).setRequired(true))
    .addIntegerOption((o) => o.setName("bet").setDescription("Credits to wager (1–250000)").setMinValue(1).setMaxValue(250000).setRequired(true)),
  new SlashCommandBuilder()
    .setName("mines")
    .setDescription("Play Mines for credits.")
    .addIntegerOption((o) => o.setName("bet").setDescription("Credits to wager (1–250000)").setMinValue(1).setMaxValue(250000).setRequired(true))
    .addIntegerOption((o) => o.setName("mine_count").setDescription("Number of mines (1–8, default 3)").setMinValue(1).setMaxValue(8)),
  new SlashCommandBuilder()
    .setName("gstart")
    .setDescription("Start a giveaway.")
    .addStringOption((o) => o.setName("duration").setDescription("Duration, e.g. 30s, 5m, 2h, 1d").setRequired(true))
    .addStringOption((o) => o.setName("prize").setDescription("Giveaway prize").setRequired(true))
    .addIntegerOption((o) => o.setName("winners").setDescription("Number of winners").setMinValue(1).setMaxValue(20)),
  new SlashCommandBuilder()
    .setName("gend")
    .setDescription("End a running giveaway.")
    .addStringOption((o) => o.setName("message_id").setDescription("Giveaway message ID").setRequired(true)),
  new SlashCommandBuilder()
    .setName("greroll")
    .setDescription("Reroll giveaway winner(s).")
    .addStringOption((o) => o.setName("message_id").setDescription("Giveaway message ID").setRequired(true))
    .addIntegerOption((o) => o.setName("amount").setDescription("Number of winners to reroll").setMinValue(1).setMaxValue(20)),
  new SlashCommandBuilder()
    .setName("afk")
    .setDescription("Set or clear your AFK status.")
    .addStringOption((o) => o.setName("status").setDescription("Optional AFK status")),
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member.")
    .addUserOption((o) => o.setName("user").setDescription("Member to warn").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true)),
  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("View a member's warnings.")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true)),
  new SlashCommandBuilder()
    .setName("clearwarnings")
    .setDescription("Clear a member's warnings.")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true)),
  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Timeout a member.")
    .addUserOption((o) => o.setName("user").setDescription("Member to mute").setRequired(true))
    .addStringOption((o) => o.setName("duration").setDescription("Duration, e.g. 30s, 5m, 2h, 1d").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason")),
  new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Remove a member timeout.")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true)),
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member.")
    .addUserOption((o) => o.setName("user").setDescription("Member to kick").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason")),
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member.")
    .addUserOption((o) => o.setName("user").setDescription("Member to ban").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason")),
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user by ID.")
    .addStringOption((o) => o.setName("user_id").setDescription("User ID").setRequired(true)),
  new SlashCommandBuilder()
    .setName("nuke")
    .setDescription("Clone the channel and delete the old one."),
  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Set channel slowmode.")
    .addIntegerOption((o) => o.setName("seconds").setDescription("0 to 21600 seconds").setMinValue(0).setMaxValue(21600).setRequired(true)),
  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Lock the current channel."),
  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Unlock the current channel."),
  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete recent messages.")
    .addIntegerOption((o) => o.setName("amount").setDescription("1 to 100 messages").setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder()
    .setName("pb")
    .setDescription("Delete recent bot messages.")
    .addIntegerOption((o) => o.setName("amount").setDescription("1 to 100 messages").setMinValue(1).setMaxValue(100)),
  new SlashCommandBuilder()
    .setName("noprefix")
    .setDescription("Configure the no-prefix role.")
    .addRoleOption((o) => o.setName("role").setDescription("Role allowed to omit !"))
    .addBooleanOption((o) => o.setName("remove").setDescription("Remove the current no-prefix role")),
  new SlashCommandBuilder()
    .setName("socialrole")
    .setDescription("Set one or more roles required to use social commands.")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Require any one of these roles for social commands.")
        .addRoleOption((o) => o.setName("role").setDescription("Required role").setRequired(true))
        .addRoleOption((o) => o.setName("role2").setDescription("Additional accepted role"))
        .addRoleOption((o) => o.setName("role3").setDescription("Additional accepted role"))
        .addRoleOption((o) => o.setName("role4").setDescription("Additional accepted role"))
        .addRoleOption((o) => o.setName("role5").setDescription("Additional accepted role")),
    )
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("Show the current social-command role requirement."),
    )
    .addSubcommand((sub) =>
      sub.setName("remove").setDescription("Allow everyone to use social commands again."),
    ),
  new SlashCommandBuilder()
    .setName("modrole")
    .setDescription("Restrict warning and timeout commands to a role.")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Choose the role allowed to warn and timeout members.")
        .addRoleOption((o) => o.setName("role").setDescription("Authorized moderator role").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("Show the configured moderation role."),
    )
    .addSubcommand((sub) =>
      sub.setName("remove").setDescription("Remove the configured moderation role."),
    ),
  new SlashCommandBuilder()
    .setName("voice")
    .setDescription("Manage your Join to Create voice channel.")
    .addSubcommand((sub) => sub.setName("help").setDescription("Show custom voice channel commands.")),
  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("View member information.")
    .addUserOption((o) => o.setName("user").setDescription("Optional member")),
  new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("View server information."),
  new SlashCommandBuilder()
    .setName("mc")
    .setDescription("Show online, idle, DND, and offline member counts."),
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Show bot latency and uptime."),
  new SlashCommandBuilder()
    .setName("botinfo")
    .setDescription("Show bot information."),
  new SlashCommandBuilder()
    .setName("channelinfo")
    .setDescription("Show current channel information."),
  new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Show a member's avatar.")
    .addUserOption((o) => o.setName("user").setDescription("Optional member")),
  new SlashCommandBuilder()
    .setName("quote")
    .setDescription("Create a black quote card using your avatar.")
    .addStringOption((o) => o.setName("text").setDescription("Quote text").setMaxLength(450).setRequired(true)),
  new SlashCommandBuilder()
    .setName("setquote")
    .setDescription("Choose the channel where quote cards can be created.")
    .addChannelOption((o) => o.setName("channel").setDescription("Quote text channel").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder()
    .setName("role")
    .setDescription("Add or remove a role.")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)),
  new SlashCommandBuilder()
    .setName("nick")
    .setDescription("Change or reset a member nickname.")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption((o) => o.setName("nickname").setDescription("New nickname or reset").setRequired(true)),
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send an announcement embed.")
    .addChannelOption((o) => o.setName("channel").setDescription("Target channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption((o) => o.setName("message").setDescription("Announcement text").setRequired(true)),
  new SlashCommandBuilder()
    .setName("send")
    .setDescription("Send an announcement embed.")
    .addChannelOption((o) => o.setName("channel").setDescription("Target channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption((o) => o.setName("message").setDescription("Announcement text").setRequired(true)),
  new SlashCommandBuilder()
    .setName("autoreact")
    .setDescription("Configure automatic emoji reactions in a channel.")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("React to every message in a channel.")
        .addChannelOption((o) => o.setName("channel").setDescription("Text channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption((o) => o.setName("emoji").setDescription("Emoji to react with").setRequired(true))
        .addStringOption((o) => o.setName("trigger").setDescription("Optional text that must appear in the message").setMaxLength(120)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Turn off automatic reactions in a channel.")
        .addChannelOption((o) => o.setName("channel").setDescription("Text channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Show the automatic reaction for a channel.")
        .addChannelOption((o) => o.setName("channel").setDescription("Text channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)),
    ),
  new SlashCommandBuilder()
    .setName("sticky")
    .setDescription("Keep one message at the bottom of a channel.")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set or replace the sticky message.")
        .addChannelOption((o) => o.setName("channel").setDescription("Text channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption((o) => o.setName("mode").setDescription("Send as an embed or plain message").addChoices({ name: "Embed", value: "embed" }, { name: "Plain message", value: "plain" }))
        .addStringOption((o) => o.setName("message").setDescription("Sticky text").setMaxLength(1500).setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove the sticky message from a channel.")
        .addChannelOption((o) => o.setName("channel").setDescription("Text channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)),
    ),
  new SlashCommandBuilder()
    .setName("jtc")
    .setDescription("Configure Join to Create temporary voice channels.")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set the lobby voice channel and optional category.")
        .addChannelOption((o) => o.setName("channel").setDescription("Lobby voice channel").addChannelTypes(ChannelType.GuildVoice).setRequired(true))
        .addChannelOption((o) => o.setName("category").setDescription("Category for new channels (defaults to the lobby's category)").addChannelTypes(ChannelType.GuildCategory)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Turn off Join to Create for this server."),
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Show the current lobby and category."),
    ),
  new SlashCommandBuilder()
    .setName("welcome")
    .setDescription("Configure server welcome messages.")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set a welcome message and channel.")
        .addChannelOption((o) => o.setName("channel").setDescription("Text channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption((o) => o.setName("message").setDescription("Message text").setMaxLength(1800).setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName("remove").setDescription("Turn off welcome messages."),
    ),
  new SlashCommandBuilder()
    .setName("wordbomb")
    .setDescription("Start a Word Bomb game in the configured games channel."),
  new SlashCommandBuilder()
    .setName("games")
    .setDescription("Choose a game to drop in the configured game channel."),
  new SlashCommandBuilder()
    .setName("setgame")
    .setDescription("Add a channel where server games can be played.")
    .addChannelOption((o) => o.setName("channel").setDescription("Games text channel").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder()
    .setName("creditdrop")
    .setDescription("Configure automatic credit drops.")
    .addSubcommand((sub) => sub.setName("setup").setDescription("Enable credit drops in a channel.")
      .addChannelOption((o) => o.setName("channel").setDescription("Drop channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption((o) => o.setName("interval").setDescription("Interval, e.g. 30m or 2h")))
    .addSubcommand((sub) => sub.setName("remove").setDescription("Remove credit drops from a channel.")
      .addChannelOption((o) => o.setName("channel").setDescription("Drop channel").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((sub) => sub.setName("interval").setDescription("Change the drop interval.")
      .addStringOption((o) => o.setName("interval").setDescription("Interval, e.g. 30m or 2h").setRequired(true))
      .addChannelOption((o) => o.setName("channel").setDescription("Drop channel").addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((sub) => sub.setName("status").setDescription("Show credit drop settings."))
    .addSubcommand((sub) => sub.setName("pause").setDescription("Pause credit drops.")
      .addChannelOption((o) => o.setName("channel").setDescription("Drop channel").addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((sub) => sub.setName("resume").setDescription("Resume credit drops.")
      .addChannelOption((o) => o.setName("channel").setDescription("Drop channel").addChannelTypes(ChannelType.GuildText))),
  new SlashCommandBuilder()
    .setName("flagdrop")
    .setDescription("Configure automatic flag drops.")
    .addSubcommand((sub) => sub.setName("setup").setDescription("Enable flag drops in a channel.")
      .addChannelOption((o) => o.setName("channel").setDescription("Drop channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption((o) => o.setName("interval").setDescription("Interval, e.g. 15m or 2h")))
    .addSubcommand((sub) => sub.setName("remove").setDescription("Remove flag drops from a channel.")
      .addChannelOption((o) => o.setName("channel").setDescription("Drop channel").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((sub) => sub.setName("interval").setDescription("Change the drop interval.")
      .addStringOption((o) => o.setName("interval").setDescription("Interval, e.g. 15m or 2h").setRequired(true))
      .addChannelOption((o) => o.setName("channel").setDescription("Drop channel").addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((sub) => sub.setName("status").setDescription("Show flag drop settings."))
    .addSubcommand((sub) => sub.setName("pause").setDescription("Pause flag drops.")
      .addChannelOption((o) => o.setName("channel").setDescription("Drop channel").addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((sub) => sub.setName("resume").setDescription("Resume flag drops.")
      .addChannelOption((o) => o.setName("channel").setDescription("Drop channel").addChannelTypes(ChannelType.GuildText))),
  new SlashCommandBuilder()
    .setName("setchatreward")
    .setDescription("Configure active chat reward announcement channels.")
    .addSubcommand((sub) => sub.setName("set").setDescription("Add an announcement channel.")
      .addChannelOption((o) => o.setName("channel").setDescription("Reward announcement text channel").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((sub) => sub.setName("remove").setDescription("Remove a channel, or all channels.")
      .addChannelOption((o) => o.setName("channel").setDescription("Channel to remove; omit to clear all").addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((sub) => sub.setName("status").setDescription("List announcement channels.")),
  new SlashCommandBuilder()
    .setName("setgambling")
    .setDescription("Choose the channel where gambling commands can be used.")
    .addChannelOption((o) => o.setName("channel").setDescription("Gambling text channel")),
  new SlashCommandBuilder()
    .setName("wbstop")
    .setDescription("Stop the current Word Bomb game."),
  new SlashCommandBuilder()
    .setName("wbtop")
    .setDescription("Show the Word Bomb leaderboard."),
  new SlashCommandBuilder()
    .setName("ship")
    .setDescription("Get a playful compatibility score for two members.")
    .addUserOption((o) => o.setName("user1").setDescription("First member").setRequired(true))
    .addUserOption((o) => o.setName("user2").setDescription("Second member").setRequired(true)),

  new SlashCommandBuilder()
    .setName("credit")
    .setDescription("Check your or another member's credit balance.")
    .addUserOption((o) => o.setName("user").setDescription("Member")),
  new SlashCommandBuilder()
    .setName("credits")
    .setDescription("Check your or another member's credit balance.")
    .addUserOption((o) => o.setName("user").setDescription("Member")),

  new SlashCommandBuilder()
    .setName("topcredits")
    .setDescription("Show the credit leaderboard."),

  new SlashCommandBuilder()
    .setName("shop")
    .setDescription("View or purchase roles from the role shop.")
    .addStringOption((o) => o.setName("args").setDescription("Action or role name e.g. buy <role>")),

  new SlashCommandBuilder()
    .setName("steal")
    .setDescription("Steal a custom emoji or sticker from a message or URL.")
    .addStringOption((o) => o.setName("source").setDescription("Emoji, emoji ID, image URL, or message link").setRequired(true))
    .addStringOption((o) => o.setName("name").setDescription("Custom name for the new emoji")),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Manage custom server embeds.")
    .addStringOption((o) => o.setName("action").setDescription("Action, e.g. list, show <name>, new <name>, edit <name> <key> <val>").setRequired(true)),

  new SlashCommandBuilder()
    .setName("autoresponder")
    .setDescription("Configure auto responders.")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set an auto responder.")
        .addStringOption((o) => o.setName("trigger").setDescription("Trigger text").setRequired(true))
        .addStringOption((o) => o.setName("response").setDescription("Response text").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove an auto responder.")
        .addStringOption((o) => o.setName("trigger").setDescription("Trigger text").setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName("status").setDescription("View auto responders.")),

  new SlashCommandBuilder()
    .setName("goodbye")
    .setDescription("Configure goodbye messages.")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set goodbye channel and message.")
        .addChannelOption((o) => o.setName("channel").setDescription("Text channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption((o) => o.setName("message").setDescription("Goodbye message text").setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName("remove").setDescription("Disable goodbye messages.")),

  new SlashCommandBuilder()
    .setName("boost")
    .setDescription("Configure server boost messages.")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set boost channel and message.")
        .addChannelOption((o) => o.setName("channel").setDescription("Text channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption((o) => o.setName("message").setDescription("Boost message text").setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName("remove").setDescription("Disable boost messages.")),

  new SlashCommandBuilder()
    .setName("reminder")
    .setDescription("Set or manage reminders.")
    .addSubcommand((sub) =>
      sub
        .setName("start")
        .setDescription("Set a reminder.")
        .addStringOption((o) => o.setName("duration").setDescription("Duration e.g. 30m, 1h").setRequired(true))
        .addStringOption((o) => o.setName("text").setDescription("Reminder text").setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName("clear").setDescription("Clear active reminders.")),

  new SlashCommandBuilder()
    .setName("timer")
    .setDescription("Set a timer.")
    .addStringOption((o) => o.setName("duration").setDescription("Duration e.g. 10m").setRequired(true))
    .addStringOption((o) => o.setName("text").setDescription("Timer text")),

  new SlashCommandBuilder()
    .setName("statusrole")
    .setDescription("Configure status roles.")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set a status role.")
        .addRoleOption((o) => o.setName("role").setDescription("Role to award").setRequired(true))
        .addStringOption((o) => o.setName("text").setDescription("Required status text").setRequired(true))
        .addChannelOption((o) => o.setName("channel").setDescription("Announcement channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    )
    .addSubcommand((sub) => sub.setName("remove").setDescription("Remove status role configuration."))
    .addSubcommand((sub) => sub.setName("status").setDescription("View status role settings.")),

  new SlashCommandBuilder()
    .setName("guildtagrole")
    .setDescription("Configure guild tag roles.")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set a guild tag role.")
        .addRoleOption((o) => o.setName("role").setDescription("Role to award").setRequired(true))
        .addStringOption((o) => o.setName("text").setDescription("Required tag text").setRequired(true))
        .addChannelOption((o) => o.setName("channel").setDescription("Announcement channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    )
    .addSubcommand((sub) => sub.setName("remove").setDescription("Remove guild tag role configuration."))
    .addSubcommand((sub) => sub.setName("status").setDescription("View guild tag role settings.")),

  new SlashCommandBuilder()
    .setName("emergency")
    .setDescription("Configure emergency protections.")
    .addSubcommand((sub) => sub.setName("status").setDescription("View emergency settings."))
    .addSubcommand((sub) => sub.setName("restore").setDescription("Restore emergency protections."))
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set emergency threshold.")
        .addStringOption((o) => o.setName("event").setDescription("Event type").setRequired(true))
        .addIntegerOption((o) => o.setName("limit").setDescription("Limit count").setMinValue(1).setRequired(true)),
    ),

  new SlashCommandBuilder()
    .setName("automod")
    .setDescription("Configure auto moderation.")
    .addStringOption((o) => o.setName("args").setDescription("Automod parameters")),

  new SlashCommandBuilder()
    .setName("modlimit")
    .setDescription("Configure moderation limits.")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set limit for action.")
        .addStringOption((o) => o.setName("action").setDescription("Action type e.g. warn, mute").setRequired(true))
        .addIntegerOption((o) => o.setName("limit").setDescription("Limit").setMinValue(1).setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName("status").setDescription("View moderation limits."))
    .addSubcommand((sub) => sub.setName("reset").setDescription("Reset moderation limits.")),

  new SlashCommandBuilder()
    .setName("hide")
    .setDescription("Hide current channel or specified channel.")
    .addChannelOption((o) => o.setName("channel").setDescription("Target channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice)),

  new SlashCommandBuilder()
    .setName("unhide")
    .setDescription("Unhide current channel or specified channel.")
    .addChannelOption((o) => o.setName("channel").setDescription("Target channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice)),

  new SlashCommandBuilder()
    .setName("roleinfo")
    .setDescription("View information about a role.")
    .addRoleOption((o) => o.setName("role").setDescription("Target role").setRequired(true)),

  new SlashCommandBuilder()
    .setName("banner")
    .setDescription("View a member's banner.")
    .addUserOption((o) => o.setName("user").setDescription("Optional member")),

  new SlashCommandBuilder()
    .setName("snipe")
    .setDescription("Snipe the last deleted message in this channel."),

  new SlashCommandBuilder()
    .setName("quoterole")
    .setDescription("Configure role required to create quotes.")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set required role.")
        .addRoleOption((o) => o.setName("role").setDescription("Authorized quote role").setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName("status").setDescription("Show configured quote role."))
    .addSubcommand((sub) => sub.setName("remove").setDescription("Remove quote role requirement.")),

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Configure tickets or post the support ticket panel.")
    .addStringOption((o) => o.setName("args").setDescription("setup #category, panel, close, or status")),

  // Discord allows at most 100 slash commands per guild, so all social actions
  // (hug, kiss, ...) share one /social command with an autocompleted action.
  new SlashCommandBuilder()
    .setName("social")
    .setDescription("Use a social action like hug, kiss or pat on a member.")
    .addStringOption((o) => o.setName("action").setDescription("Social action").setRequired(true).setAutocomplete(true))
    .addUserOption((o) => o.setName("user").setDescription("Member to interact with").setRequired(true)),
].map((command) => command.toJSON());

function mentionContent(interaction: ChatInputCommandInteraction, optionName: string, fallback = ""): string {
  const user = interaction.options.getUser(optionName);
  return user ? `<@${user.id}>` : fallback;
}

function automationCommandContent(
  interaction: ChatInputCommandInteraction,
  command: "autoreact" | "sticky" | "welcome" | "goodbye" | "boost",
): string {
  const action = interaction.options.getSubcommand(false) ?? "set";
  const channel = interaction.options.getChannel("channel");
  const channelText = channel ? `<#${channel.id}>` : "";
  const value =
    interaction.options.getString("emoji") ??
    interaction.options.getString("message") ??
    "";
  const mode = command === "sticky" ? interaction.options.getString("mode") : null;
  const trigger = command === "autoreact" ? interaction.options.getString("trigger") ?? "" : "";
  return `!${command} ${action} ${channelText}${mode ? ` ${mode}` : ""} ${value} ${trigger}`.trim();
}

function buildLegacyContent(interaction: ChatInputCommandInteraction): string {
  const name = interaction.commandName;
  const string = (option: string) => interaction.options.getString(option) ?? "";
  const integer = (option: string) => interaction.options.getInteger(option);

  switch (name) {
    case "gstart": {
      const winners = integer("winners");
      return `!gstart ${string("duration")}${winners ? ` ${winners}` : ""} ${string("prize")}`;
    }
    case "gend":
      return `!gend ${string("message_id")}`;
    case "greroll": {
      const amount = integer("amount");
      return `!greroll ${string("message_id")}${amount ? ` ${amount}` : ""}`;
    }
    case "afk":
      return `!afk ${string("status")}`.trim();
    case "coinflip":
      return `!coinflip ${string("side")} ${integer("bet")}`;
    case "mines": {
      const mineCount = integer("mine_count");
      return `!mines ${integer("bet")}${mineCount === null ? "" : ` ${mineCount}`}`;
    }
    case "warn":
      return `!warn ${mentionContent(interaction, "user")} ${string("reason")}`.trim();
    case "warnings":
      return `!warnings ${mentionContent(interaction, "user")}`;
    case "clearwarnings":
      return `!clearwarnings ${mentionContent(interaction, "user")}`;
    case "mute":
      return `!mute ${mentionContent(interaction, "user")} ${string("duration")} ${string("reason")}`.trim();
    case "unmute":
      return `!unmute ${mentionContent(interaction, "user")}`;
    case "kick":
      return `!kick ${mentionContent(interaction, "user")} ${string("reason")}`.trim();
    case "ban":
      return `!ban ${mentionContent(interaction, "user")} ${string("reason")}`.trim();
    case "unban":
      return `!unban ${string("user_id")}`;
    case "slowmode":
      return `!slowmode ${integer("seconds")}`;
    case "purge":
      return `!purge ${integer("amount")}`;
    case "pb":
      return `!pb ${integer("amount") ?? 50}`;
    case "noprefix": {
      if (interaction.options.getBoolean("remove")) return "!noprefix remove";
      const role = interaction.options.getRole("role");
      return role ? `!noprefix <@&${role.id}>` : "!noprefix";
    }
    case "socialrole": {
      const action = interaction.options.getSubcommand(false) ?? "status";
      if (action !== "set") return `!socialrole ${action}`;
      const roles = ["role", "role2", "role3", "role4", "role5"]
        .map((name) => interaction.options.getRole(name))
        .filter((role): role is Role => role !== null);
      return roles.length
        ? `!socialrole set ${roles.map((role) => `<@&${role.id}>`).join(" ")}`
        : "!socialrole status";
    }
    case "modrole": {
      const action = interaction.options.getSubcommand(false) ?? "status";
      if (action !== "set") return `!modrole ${action}`;
      const role = interaction.options.getRole("role");
      return role ? `!modrole set <@&${role.id}>` : "!modrole status";
    }
    case "setgame": {
      const channel = interaction.options.getChannel("channel");
      return channel ? `!setgame <#${channel.id}>` : "!setgame status";
    }
    case "creditdrop":
    case "flagdrop": {
      const action = interaction.options.getSubcommand();
      const channel = interaction.options.getChannel("channel");
      const interval = interaction.options.getString("interval");
      const channelArg = channel ? ` <#${channel.id}>` : "";
      if (action === "setup") return `!${interaction.commandName} setup <#${channel!.id}>${interval ? ` ${interval}` : ""}`;
      if (action === "remove") return `!${interaction.commandName} remove <#${channel!.id}>`;
      if (action === "interval") return `!${interaction.commandName} interval ${interval}${channelArg}`;
      return `!${interaction.commandName} ${action}${channelArg}`;
    }
    case "setchatreward": {
      const action = interaction.options.getSubcommand();
      const channel = interaction.options.getChannel("channel");
      if (action === "set" && channel) return `!setchatreward <#${channel.id}>`;
      if (action === "remove") return channel ? `!setchatreward remove <#${channel.id}>` : "!setchatreward remove";
      return "!setchatreward status";
    }
    case "setgambling": {
      const channel = interaction.options.getChannel("channel");
      return channel ? `!setgambling <#${channel.id}>` : "!setgambling status";
    }
    case "games":
      return "!games";
    case "voice":
      return `!voice ${interaction.options.getSubcommand(false) ?? "help"}`;
    case "ship":
      return `!ship ${mentionContent(interaction, "user1")} ${mentionContent(interaction, "user2")}`.trim();
    case "userinfo":
      return `!userinfo ${mentionContent(interaction, "user")}`.trim();
    case "avatar":
      return `!avatar ${mentionContent(interaction, "user")}`.trim();
    case "quote":
      return `!quote ${string("text")}`;
    case "setquote": {
      const channel = interaction.options.getChannel("channel");
      return channel ? `!setquote <#${channel.id}>` : "!setquote status";
    }
    case "role": {
      const role = interaction.options.getRole("role");
      return `!role ${mentionContent(interaction, "user")} ${role ? `<@&${role.id}>` : ""}`.trim();
    }
    case "nick":
      return `!nick ${mentionContent(interaction, "user")} ${string("nickname")}`.trim();
    case "announce":
    case "send": {
      const channel = interaction.options.getChannel("channel");
      return `!announce ${channel ? `<#${channel.id}>` : ""} ${string("message")}`.trim();
    }
    case "jtc": {
      const action = interaction.options.getSubcommand(false) ?? "status";
      if (action !== "set") return `!jtc ${action}`;
      const lobby = interaction.options.getChannel("channel");
      const category = interaction.options.getChannel("category");
      return `!jtc set ${lobby ? `<#${lobby.id}>` : ""} ${category ? `<#${category.id}>` : ""}`.trim();
    }
    case "credit":
    case "credits":
      return `!credit ${mentionContent(interaction, "user")}`.trim();
    case "topcredits":
      return "!top credits";
    case "shop":
      return `!shop ${string("args")}`.trim();
    case "steal":
      return `!steal ${string("source")} ${string("name")}`.trim();
    case "embed":
      return `!embed ${string("action")}`.trim();
    case "autoresponder": {
      const sub = interaction.options.getSubcommand(false) ?? "status";
      if (sub === "status") return "!autoresponder status";
      const trigger = string("trigger");
      const response = string("response");
      return `!autoresponder ${sub} ${trigger} ${response}`.trim();
    }
    case "reminder": {
      const sub = interaction.options.getSubcommand(false) ?? "clear";
      if (sub === "clear") return "!reminder clear";
      return `!reminder start ${string("duration")} ${string("text")}`.trim();
    }
    case "timer":
      return `!timer ${string("duration")} ${string("text")}`.trim();
    case "statusrole":
    case "guildtagrole": {
      const sub = interaction.options.getSubcommand(false) ?? "status";
      if (sub === "status" || sub === "remove") return `!${name} ${sub}`;
      const role = interaction.options.getRole("role");
      const text = string("text");
      const channel = interaction.options.getChannel("channel");
      return `!${name} set ${role ? `<@&${role.id}>` : ""} ${text} ${channel ? `<#${channel.id}>` : ""}`.trim();
    }
    case "emergency": {
      const sub = interaction.options.getSubcommand(false) ?? "status";
      if (sub === "status" || sub === "restore") return `!auto emergency ${sub}`;
      return `!auto emergency set ${string("event")} ${integer("limit")}`.trim();
    }
    case "automod":
      return `!automod ${string("args")}`.trim();
    case "modlimit": {
      const sub = interaction.options.getSubcommand(false) ?? "status";
      if (sub === "status" || sub === "reset") return `!modlimit ${sub}`;
      return `!modlimit set ${string("action")} ${integer("limit")}`.trim();
    }
    case "hide":
    case "unhide": {
      const channel = interaction.options.getChannel("channel");
      return `!${name} ${channel ? `<#${channel.id}>` : ""}`.trim();
    }
    case "roleinfo": {
      const role = interaction.options.getRole("role");
      return `!roleinfo ${role ? `<@&${role.id}>` : ""}`.trim();
    }
    case "banner":
      return `!banner ${mentionContent(interaction, "user")}`.trim();
    case "snipe":
      return "!snipe";
    case "quoterole": {
      const sub = interaction.options.getSubcommand(false) ?? "status";
      if (sub === "status" || sub === "remove") return `!quoterole ${sub}`;
      const role = interaction.options.getRole("role");
      return `!quoterole set ${role ? `<@&${role.id}>` : ""}`.trim();
    }
    case "social": {
      const action = string("action").toLowerCase();
      return `!${action} ${mentionContent(interaction, "user")}`.trim();
    }
    case "ticket":
      return `!ticket ${string("args")}`.trim();
    case "autoreact":
    case "sticky":
    case "welcome":
    case "goodbye":
    case "boost":
      return automationCommandContent(interaction, name);
    default:
      return `!${name}`;
  }
}

async function createMessageAdapter(interaction: ChatInputCommandInteraction, content: string): Promise<Message> {
  const guild = interaction.guild!;
  const user = interaction.user;
  const member = guild.members.cache.get(user.id) ?? (interaction.member instanceof GuildMember
    ? interaction.member
    : await guild.members.fetch(user.id).catch(() => null));
  const selectedUsers = new Collection<string, User>();
  const selectedMembers = new Collection<string, GuildMember>();
  const selectedRoles = new Collection<string, Role>();

  for (const option of ["user", "user1", "user2"]) {
    const selected = interaction.options.getUser(option);
    if (selected) {
      selectedUsers.set(selected.id, selected);
      const selectedMember = guild.members.cache.get(selected.id) ?? await guild.members.fetch(selected.id).catch(() => null);
      if (selectedMember) selectedMembers.set(selected.id, selectedMember);
    }
  }

  const selectedRole = interaction.options.getRole("role");
  const role = selectedRole
    ? guild.roles.cache.get(selectedRole.id) ?? await guild.roles.fetch(selectedRole.id).catch(() => null)
    : undefined;
  if (role) selectedRoles.set(role.id, role);

  const channel = interaction.channel;
  const mentionedChannel = interaction.options.getChannel("channel") ?? channel;
  const selectedChannels = new Collection<string, any>();
  if (mentionedChannel) selectedChannels.set(mentionedChannel.id, mentionedChannel);
  const mentions = {
    users: selectedUsers,
    members: selectedMembers,
    roles: selectedRoles,
    channels: selectedChannels,
  };

  return {
    id: interaction.id,
    content,
    author: user,
    client: interaction.client,
    guild,
    channel,
    member,
    mentions,
    reply: async (payload: unknown) => {
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply(payload as never);
        return interaction.fetchReply();
      }
      if (interaction.replied) {
        return interaction.followUp(payload as never);
      }
      await interaction.reply(payload as never);
      return interaction.fetchReply();
    },
    delete: async () => {},
  } as unknown as Message;
}

export async function registerSlashCommands(client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.commands.set(slashCommands);
    } catch (err) {
      logger.error({ err, guildId: guild.id }, "Failed to register slash commands");
    }
  }
  logger.info({ commands: slashCommands.length, guilds: client.guilds.cache.size }, "Slash commands registered");
}

export async function handleSocialAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const typed = interaction.options.getFocused().toLowerCase();
  const matches = SOCIAL_ACTION_NAMES.filter((name) => name.includes(typed)).slice(0, 25);
  await interaction.respond(matches.map((name) => ({ name, value: name }))).catch(() => {});
}

export async function handleSlashCommand(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      embeds: [
        premiumEmbed(
          "❌ This command can only be used inside a server.",
          { title: "Server only" },
          client.user,
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  try {
    if (interaction.commandName === "help") {
      await interaction.reply({
        content: "For private command instructions, send `!help` or `!help games` to me in a direct message.",
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === "voice") {
      await interaction.reply({ content: VC_HELP_TEXT, ephemeral: true });
      return;
    }

    await interaction.deferReply();

    const content = buildLegacyContent(interaction);
    const message = await createMessageAdapter(interaction, content);
    await handleMessage(client, message, { skipAutoModeration: true });
    await bumpStickyForChannel(client, interaction.guild.id, interaction.channelId);
  } catch (err) {
    logger.error({ err, command: interaction.commandName }, "Error handling slash command");
    if (interaction.deferred && !interaction.replied) {
      await interaction
        .editReply({
          embeds: [
            premiumEmbed(
              "❌ Something went wrong while running that command.",
              { title: "Command error" },
              client.user,
            ),
          ],
        })
        .catch(() => {});
    } else if (interaction.replied) {
      await interaction.followUp({
        embeds: [
          premiumEmbed(
            "❌ Something went wrong while running that command.",
            { title: "Command error" },
            client.user,
          ),
        ],
        ephemeral: true,
      }).catch(() => {});
    } else {
      await interaction.reply({
        embeds: [
          premiumEmbed(
            "❌ Something went wrong while running that command.",
            { title: "Command error" },
            client.user,
          ),
        ],
        ephemeral: true,
      }).catch(() => {});
    }
  }
}
