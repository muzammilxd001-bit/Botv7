export const ACTIVE_BOT_GUILD_ID = "545423389607591946";

export function isActiveBotGuild(guildId: string | null | undefined): boolean {
  return guildId === ACTIVE_BOT_GUILD_ID;
}
