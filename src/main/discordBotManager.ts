import { EventEmitter } from 'events';
import { Client, GatewayIntentBits, Message } from 'discord.js';
import { DiscordBotConfig } from '../types';

export type DiscordBotState = 'offline' | 'connecting' | 'online' | 'error';

export type PlatformTarget = 'instagram' | 'snapchat' | 'threads' | 'reddit';

export type DiscordCommand =
  | { type: 'help' }
  | { type: 'list' }
  | { type: 'status' }
  | { type: 'screenshot' }
  | { type: 'start'; target: { kind: 'all' } | { kind: 'platform'; platform: PlatformTarget } | { kind: 'session'; ref: string } }
  | { type: 'stop'; target: { kind: 'all' } | { kind: 'platform'; platform: PlatformTarget } | { kind: 'session'; ref: string } }
  | { type: 'logs'; pid: number; durationMs: number; durationLabel: string };

export interface DiscordCommandAttachment {
  filename: string;
  data: Buffer;
}

export interface DiscordCommandResponse {
  text: string;
  attachments?: DiscordCommandAttachment[];
}

const DISCORD_COMMAND_HELP_LINES = [
  'Commands:',
  '- @snappy list',
  '- @snappy status',
  '- @snappy screenshot',
  '- @snappy logs <pid> <1m|5m|10m|1h|2h>',
  '- @snappy start all',
  '- @snappy stop all',
  '- @snappy start platform <instagram|snapchat|threads|reddit>',
  '- @snappy stop platform <instagram|snapchat|threads|reddit>',
  '- @snappy start session <id|name|index>',
  '- @snappy stop session <id|name|index>'
];

export function getDiscordCommandHelpText(): string {
  return DISCORD_COMMAND_HELP_LINES.join('\n');
}

export interface DiscordBotStatus {
  state: DiscordBotState;
  botTag?: string;
  guildCount?: number;
  error?: string;
}

export interface DiscordCommandContext {
  authorId: string;
  guildId: string;
  channelId: string;
}

type DiscordCommandExecutor = (command: DiscordCommand, context: DiscordCommandContext) => Promise<string | DiscordCommandResponse>;

const PLATFORM_SET: Set<string> = new Set(['instagram', 'snapchat', 'threads', 'reddit']);
const LOG_DURATION_MAX_MS = 7 * 24 * 60 * 60 * 1000;

function parseDurationToken(token: string): { ms: number; label: string } | null {
  const normalized = String(token || '').trim().toLowerCase();
  const matched = normalized.match(/^(\d+)(s|m|h|d)$/);
  if (!matched) return null;

  const value = parseInt(matched[1], 10);
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = matched[2];
  const multiplier =
    unit === 's' ? 1000 :
    unit === 'm' ? 60 * 1000 :
    unit === 'h' ? 60 * 60 * 1000 :
    24 * 60 * 60 * 1000;

  const ms = value * multiplier;
  if (!Number.isFinite(ms) || ms <= 0 || ms > LOG_DURATION_MAX_MS) {
    return null;
  }

  return { ms, label: `${value}${unit}` };
}

function parseLogsCommand(tokens: string[]): { ok: true; command: DiscordCommand } | { ok: false; error: string } {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return { ok: false, error: 'Usage: @snappy logs <pid> <1m|5m|10m|1h|2h>' };
  }

  let pid: number | null = null;
  let duration: { ms: number; label: string } | null = null;

  for (const rawToken of tokens) {
    const token = String(rawToken || '').trim().toLowerCase();
    if (!token || token === 'pid') continue;

    if (!duration) {
      const parsedDuration = parseDurationToken(token);
      if (parsedDuration) {
        duration = parsedDuration;
        continue;
      }
    }

    if (pid === null && /^\d+$/.test(token)) {
      const parsedPid = parseInt(token, 10);
      if (Number.isFinite(parsedPid) && parsedPid > 0) {
        pid = parsedPid;
        continue;
      }
    }
  }

  if (pid === null || !duration) {
    return { ok: false, error: 'Usage: @snappy logs <pid> <1m|5m|10m|1h|2h>' };
  }

  return {
    ok: true,
    command: {
      type: 'logs',
      pid,
      durationMs: duration.ms,
      durationLabel: duration.label
    }
  };
}

function truncateDiscordReply(text: string, maxLength: number = 1900): string {
  const value = String(text || '');
  if (value.length <= maxLength) {
    return value;
  }
  const suffix = '\n...(truncated)';
  const keep = Math.max(1, maxLength - suffix.length);
  return `${value.slice(0, keep)}${suffix}`;
}

function normalizeConfig(input: Partial<DiscordBotConfig> | undefined | null): DiscordBotConfig {
  const rawTrusted = Array.isArray(input?.trustedUserIds) ? input?.trustedUserIds : [];
  const trustedUserIds = Array.from(new Set(
    rawTrusted
      .map(value => String(value || '').trim())
      .filter(value => /^\d{5,25}$/.test(value))
  ));

  return {
    enabled: input?.enabled === true,
    token: typeof input?.token === 'string' ? input.token.trim() : '',
    trustedUserIds
  };
}

function stripBotMention(content: string, botId: string): string {
  const mentionVariants = [new RegExp(`<@!?${botId}>`, 'g')];
  let stripped = content || '';
  mentionVariants.forEach(pattern => {
    stripped = stripped.replace(pattern, ' ');
  });
  return stripped.replace(/\s+/g, ' ').trim();
}

function parseTarget(action: 'start' | 'stop', tokens: string[]): DiscordCommand {
  if (tokens.length === 0 || tokens[0] === 'all') {
    return { type: action, target: { kind: 'all' } };
  }

  if (tokens[0] === 'platform' && tokens[1]) {
    const platform = tokens[1].toLowerCase();
    if (PLATFORM_SET.has(platform)) {
      return { type: action, target: { kind: 'platform', platform: platform as PlatformTarget } };
    }
  }

  if (tokens[0] === 'session' && tokens[1]) {
    return { type: action, target: { kind: 'session', ref: tokens.slice(1).join(' ').trim() } };
  }

  if (tokens[0] && PLATFORM_SET.has(tokens[0].toLowerCase())) {
    return { type: action, target: { kind: 'platform', platform: tokens[0].toLowerCase() as PlatformTarget } };
  }

  return { type: action, target: { kind: 'session', ref: tokens.join(' ').trim() } };
}

function normalizeCommandToken(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^[`"'“”‘’([{<\s]+/, '')
    .replace(/[`"'“”‘’)\]}>:;,.!?]+$/g, '');
}

function trimLeadingCommandPrefixes(tokens: string[]): string[] {
  const result = [...tokens];
  while (result.length > 1) {
    const token = normalizeCommandToken(result[0]);
    if (!token) {
      result.shift();
      continue;
    }
    if (token.startsWith('@') || token === 'snappy' || token === 'bot') {
      result.shift();
      continue;
    }
    break;
  }
  return result;
}

function isScreenshotAction(action: string): boolean {
  return action === 'screenshot' || action === 'screen' || action === 'shot' || action === 'capture';
}

export function parseDiscordCommand(text: string): { ok: true; command: DiscordCommand } | { ok: false; error: string } {
  const normalized = (text || '').trim().toLowerCase();
  if (!normalized) {
    return { ok: true, command: { type: 'help' } };
  }

  if (normalized === 'help' || normalized === '?') {
    return { ok: true, command: { type: 'help' } };
  }

  if (normalized === 'list' || normalized === 'sessions' || normalized === 'list sessions' || normalized === 'list what sessions are active') {
    return { ok: true, command: { type: 'list' } };
  }

  if (normalized === 'status' || normalized === 'session status') {
    return { ok: true, command: { type: 'status' } };
  }

  const rawTokens = normalized.split(/\s+/).filter(Boolean);
  const tokens = trimLeadingCommandPrefixes(rawTokens);
  const action = normalizeCommandToken(tokens[0]);

  if (isScreenshotAction(action)) {
    return { ok: true, command: { type: 'screenshot' } };
  }

  if (action === 'start' || action === 'stop') {
    return { ok: true, command: parseTarget(action, tokens.slice(1)) };
  }

  if (action === 'logs' || action === 'log') {
    return parseLogsCommand(tokens.slice(1));
  }

  return { ok: false, error: 'Unknown command' };
}

export class DiscordBotManager extends EventEmitter {
  private client: Client | null = null;
  private config: DiscordBotConfig = normalizeConfig(undefined);
  private status: DiscordBotStatus = { state: 'offline' };
  private readonly executor: DiscordCommandExecutor;

  constructor(executor: DiscordCommandExecutor) {
    super();
    this.executor = executor;
  }

  setConfig(config: Partial<DiscordBotConfig> | undefined | null): void {
    this.config = normalizeConfig(config);
  }

  getConfig(): DiscordBotConfig {
    return {
      enabled: this.config.enabled,
      token: this.config.token,
      trustedUserIds: [...this.config.trustedUserIds]
    };
  }

  getStatus(): DiscordBotStatus {
    return { ...this.status };
  }

  private setStatus(next: DiscordBotStatus): void {
    this.status = next;
    this.emit('statusChanged', this.getStatus());
  }

  private isTrustedUser(userId: string): boolean {
    if (!Array.isArray(this.config.trustedUserIds) || this.config.trustedUserIds.length === 0) {
      return false;
    }
    return this.config.trustedUserIds.includes(userId);
  }

  async start(): Promise<{ success: boolean; error?: string }> {
    if (this.client) {
      if (this.status.state === 'online' || this.status.state === 'connecting') {
        return { success: true };
      }
      await this.stop();
    }

    const token = String(this.config.token || '').trim();
    if (!token) {
      this.setStatus({ state: 'error', error: 'Discord bot token is missing' });
      return { success: false, error: 'Discord bot token is missing' };
    }

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });
    this.client = client;
    this.setStatus({ state: 'connecting' });

    client.on('ready', () => {
      this.setStatus({
        state: 'online',
        botTag: client.user?.tag || undefined,
        guildCount: client.guilds.cache.size
      });
      console.log(`[DiscordBot] Connected as ${client.user?.tag || 'unknown'}`);
    });

    client.on('error', (error) => {
      this.setStatus({ state: 'error', error: error.message || String(error) });
    });

    client.on('shardDisconnect', () => {
      this.setStatus({ state: 'offline', botTag: client.user?.tag || undefined, guildCount: client.guilds.cache.size });
    });

    client.on('messageCreate', (message) => {
      void this.handleMessage(message);
    });

    try {
      await client.login(token);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.setStatus({ state: 'error', error: errorMessage });
      try {
        client.destroy();
      } catch {
        // Ignore shutdown errors.
      }
      this.client = null;
      return { success: false, error: errorMessage };
    }
  }

  async stop(): Promise<{ success: boolean; error?: string }> {
    if (!this.client) {
      this.setStatus({ state: 'offline' });
      return { success: true };
    }

    try {
      this.client.removeAllListeners();
      await this.client.destroy();
      this.client = null;
      this.setStatus({ state: 'offline' });
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.setStatus({ state: 'error', error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    const client = this.client;
    if (!client || !client.user) return;
    if (!message.inGuild()) return;
    if (message.author.bot) return;
    if (!message.mentions.has(client.user)) return;
    if (!this.isTrustedUser(message.author.id)) return;

    const stripped = stripBotMention(message.content, client.user.id);
    const parsed = parseDiscordCommand(stripped);
    if (!parsed.ok) {
      await message.reply(`${parsed.error}. Try \`@snappy help\`.`);
      return;
    }

    const context: DiscordCommandContext = {
      authorId: message.author.id,
      guildId: message.guildId || '',
      channelId: message.channelId
    };

    try {
      const response = await this.executor(parsed.command, context);
      if (typeof response === 'string') {
        await message.reply(truncateDiscordReply(response));
        return;
      }

      const normalizedText = truncateDiscordReply(response.text || 'Command completed.');
      const files = Array.isArray(response.attachments)
        ? response.attachments
            .filter(item =>
              item &&
              typeof item.filename === 'string' &&
              item.filename.trim().length > 0 &&
              Buffer.isBuffer(item.data) &&
              item.data.length > 0
            )
            .map(item => ({
              attachment: item.data,
              name: item.filename.trim()
            }))
        : [];

      if (files.length > 0) {
        await message.reply({
          content: normalizedText,
          files
        });
        return;
      }

      await message.reply(normalizedText);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await message.reply(`Command failed: ${errorMessage}`);
    }
  }
}
