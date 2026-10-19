import {
  ApplicationCommandOptionType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Message,
  PermissionFlagsBits,
  PermissionsBitField,
} from 'discord.js';
import { KorexClient } from '../KorexClient';
import { Command } from '../structures/Command';
import { runChatInputCommand, replyCommandError } from '../commandPipeline';
import { i18n } from '../../utils/i18n';
import {
  formatUsageArgs,
  listCommandPaths,
  ParsedOption,
  ParseError,
  parseOptions,
  PREFIX_PATTERN,
  PrefixOptionDef,
  PrefixToken,
  resolveCommandPath,
  stripPrefix,
  tokenize,
} from './ArgumentParser';
import {
  MessageAutocompleteInteraction,
  MessageCommandInteraction,
  PrefixUnsupportedError,
  SAFE_ALLOWED_MENTIONS,
} from './MessageCommandInteraction';
import {
  getPrefixUnsupportedReason,
  isFullyUnsupported,
  isPartiallyUnsupported,
  PrefixUnsupportedReason,
  SENSITIVE_OPTION,
} from './prefixCompatibility';
import { CommandPermissionService, hasDefaultMemberPermissions } from './commandPermissions';

export interface PrefixSettings {
  prefix: string;
  /** Comandos con prefijo/mención activados en el servidor */
  enabled: boolean;
}

interface CommandJson {
  name: string;
  options?: PrefixOptionDef[];
  default_member_permissions?: string | null;
  nsfw?: boolean;
}

/** Caché local del prefijo (por proceso/shard) */
const LOCAL_PREFIX_TTL_MS = 60_000;
const LOCAL_PREFIX_MAX = 20_000;
/** Caché compartida en Redis */
const REDIS_PREFIX_TTL_S = 600;
/** Rate limit por usuario y servidor */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_S = 10;
/** Longitud máxima del texto que se intenta interpretar */
const MAX_CONTENT_LENGTH = 4000;
/** Tiempo máximo para el autocompletado sintético */
const AUTOCOMPLETE_TIMEOUT_MS = 2500;

/**
 * Comandos con prefijo.
 *
 * Detecta `<prefijo>comando args` (o `@Korex comando args`) en los mensajes y
 * ejecuta el comando SLASH correspondiente a través de MessageCommandInteraction
 * y del mismo pipeline que `interactionCreate` (mismos permisos, cooldowns,
 * comprobaciones de addon/licencia/módulo y analíticas).
 */
export class PrefixCommandHandler {
  private readonly client: KorexClient;
  private readonly localPrefixes = new Map<string, { settings: PrefixSettings; expires: number }>();
  private readonly memoryRate = new Map<string, { count: number; resetAt: number }>();
  private readonly jsonCache = new WeakMap<Command, CommandJson | null>();
  /** Permisos por comando configurados en Discord (Integraciones) */
  public readonly commandPermissions: CommandPermissionService;

  constructor(client: KorexClient) {
    this.client = client;
    this.commandPermissions = new CommandPermissionService(client);
  }

  // ═══════════════════════════════════════════════════════════════
  // PREFIJO POR SERVIDOR (caché local → Redis → BD → por defecto)
  // ═══════════════════════════════════════════════════════════════

  private get defaultPrefix(): string {
    const fallback = this.client.config.defaults.prefix;
    return PREFIX_PATTERN.test(fallback) ? fallback : '!';
  }

  private redisKey(guildId: string): string {
    return `guild:${guildId}:prefix`;
  }

  /** Prefijo del servidor (compatibilidad) */
  async getPrefix(guildId: string): Promise<string> {
    return (await this.getSettings(guildId)).prefix;
  }

  /** Prefijo e interruptor de comandos con prefijo del servidor */
  async getSettings(guildId: string): Promise<PrefixSettings> {
    const now = Date.now();
    const local = this.localPrefixes.get(guildId);
    if (local && local.expires > now) return local.settings;

    let settings: PrefixSettings | null = null;
    try {
      const cached = await this.client.redis.get<PrefixSettings>(this.redisKey(guildId));
      if (cached && typeof cached === 'object' && typeof cached.prefix === 'string' && typeof cached.enabled === 'boolean') {
        settings = cached;
      }
    } catch { /* Redis caído: se consulta la BD */ }

    if (!settings) {
      let fromDb = false;
      try {
        const guild = await this.client.db.guild.findUnique({ where: { id: guildId }, select: { prefix: true, prefixEnabled: true } });
        settings = { prefix: guild?.prefix ?? this.defaultPrefix, enabled: guild?.prefixEnabled ?? true };
        fromDb = true;
      } catch (error) {
        this.client.logger.warn(`[Prefix] No se pudo leer el prefijo de ${guildId}:`, error);
      }
      if (settings && !PREFIX_PATTERN.test(settings.prefix)) settings.prefix = this.defaultPrefix;
      if (settings && fromDb) {
        await this.client.redis.set(this.redisKey(guildId), settings, REDIS_PREFIX_TTL_S).catch(() => false);
      }
    }

    // BD inaccesible: valores por defecto (sin cachear en Redis)
    if (!settings) settings = { prefix: this.defaultPrefix, enabled: true };
    if (!PREFIX_PATTERN.test(settings.prefix)) settings = { ...settings, prefix: this.defaultPrefix };

    if (this.localPrefixes.size >= LOCAL_PREFIX_MAX) {
      // Expulsar la entrada más antigua (orden de inserción del Map)
      const oldest = this.localPrefixes.keys().next().value;
      if (oldest !== undefined) this.localPrefixes.delete(oldest);
    }
    this.localPrefixes.delete(guildId);
    this.localPrefixes.set(guildId, { settings, expires: now + LOCAL_PREFIX_TTL_MS });
    return settings;
  }

  /** Invalidar tras cambiar el prefijo o su interruptor (panel web) */
  async invalidatePrefix(guildId: string): Promise<void> {
    this.localPrefixes.delete(guildId);
    await this.client.redis.del(this.redisKey(guildId)).catch(() => false);
  }

  // ═══════════════════════════════════════════════════════════════
  // RATE LIMIT (Redis INCR+EXPIRE, con respaldo en memoria)
  // ═══════════════════════════════════════════════════════════════

  /** allowed: puede ejecutar; notify: primera vez que se pasa del límite en la ventana */
  private async checkRateLimit(guildId: string, userId: string): Promise<{ allowed: boolean; notify: boolean }> {
    const key = `${process.env.REDIS_PREFIX || 'korex:'}prefixrl:${guildId}:${userId}`;
    try {
      const redis = this.client.redis.getClient();
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, RATE_LIMIT_WINDOW_S);
      } else if (count > RATE_LIMIT_MAX) {
        // Autocorrección: si una caída dejó la clave sin TTL, nunca se liberaría
        const ttl = await redis.ttl(key);
        if (ttl < 0) await redis.expire(key, RATE_LIMIT_WINDOW_S);
      }
      return { allowed: count <= RATE_LIMIT_MAX, notify: count === RATE_LIMIT_MAX + 1 };
    } catch {
      const now = Date.now();
      const entry = this.memoryRate.get(key);
      if (!entry || entry.resetAt <= now) {
        if (this.memoryRate.size > 50_000) this.memoryRate.clear();
        this.memoryRate.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_S * 1000 });
        return { allowed: true, notify: false };
      }
      entry.count++;
      return { allowed: entry.count <= RATE_LIMIT_MAX, notify: entry.count === RATE_LIMIT_MAX + 1 };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ENTRADA DESDE messageCreate
  // ═══════════════════════════════════════════════════════════════

  /**
   * Devuelve true si el mensaje era un comando con prefijo (ya se encarga él);
   * la ejecución del comando continúa en segundo plano.
   */
  async handle(message: Message): Promise<boolean> {
    if (!message.inGuild() || message.author.bot || message.webhookId || message.system) return false;
    if (!message.member || !message.content) return false;
    const botId = this.client.user?.id;
    if (!botId) return false;

    const { prefix, enabled } = await this.getSettings(message.guildId);
    const stripped = stripPrefix(message.content, prefix, botId);
    if (!stripped) return false;

    const guildId = message.guildId;
    const body = stripped.body;

    // Mención sola al bot: indicar el prefijo (o que están desactivados)
    if (!body) {
      if (!stripped.viaMention) return false;
      if (!this.botCanSpeak(message)) return true;
      const rate = await this.checkRateLimit(guildId, message.author.id);
      if (!rate.allowed) return true;
      await i18n.getGuildLanguageAsync(this.client.db as any, guildId).catch(() => null);
      await this.sendPlain(message, enabled
        ? i18n.t('prefix_commands.mention_info', guildId, { prefix })
        : i18n.t('prefix_commands.disabled_info', guildId));
      return true;
    }

    // Interruptor del panel apagado: ni prefijo ni mención ejecutan comandos
    // (el mensaje sigue su curso normal: autorespuestas, XP…)
    if (!enabled) return false;

    // Identificar el comando ANTES de nada: si no es un comando, se ignora en silencio
    const firstSpace = body.search(/\s/);
    const name = (firstSpace === -1 ? body : body.slice(0, firstSpace)).toLowerCase();
    let rest = firstSpace === -1 ? '' : body.slice(firstSpace + 1);
    let command = this.client.commands.getCommand(name);

    // `!music play canción`: nombre de categoría seguido de un comando de esa categoría
    if (!command && name && name !== 'help') {
      const next = rest.trimStart().split(/\s+/)[0]?.toLowerCase();
      const candidate = next ? this.client.commands.getCommand(next) : undefined;
      if (candidate && candidate.category === name) {
        command = candidate;
        rest = rest.trimStart().slice(next.length);
      }
    }
    if (!command) return false;

    if (!this.botCanSpeak(message)) return true;

    const rate = await this.checkRateLimit(guildId, message.author.id);
    if (!rate.allowed) {
      if (rate.notify) await this.sendPlain(message, `⏳ ${i18n.t('prefix_commands.rate_limited', guildId)}`, true);
      return true;
    }

    // Idioma del servidor en caché antes de traducir nada
    await i18n.getGuildLanguageAsync(this.client.db as any, guildId).catch(() => null);

    void this.run(message as Message<true>, command, rest, prefix, `${prefix}${name}`).catch(error => {
      this.client.logger.error(`[Prefix] Error ejecutando ${command!.name}:`, error);
    });
    return true;
  }

  /** El bot puede ver el canal y escribir en él */
  private botCanSpeak(message: Message): boolean {
    const me = message.guild?.members.me;
    if (!me || !message.channel || !('permissionsFor' in message.channel)) return false;
    const perms = (message.channel as any).permissionsFor(me) as Readonly<PermissionsBitField> | null;
    if (!perms?.has(PermissionFlagsBits.ViewChannel)) return false;
    const isThread = message.channel.isThread();
    return perms.has(isThread ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages);
  }

  private async sendPlain(message: Message, content: string, autoDelete = false): Promise<void> {
    try {
      const msg = await message.reply({ content, allowedMentions: SAFE_ALLOWED_MENTIONS, failIfNotExists: false });
      if (autoDelete) {
        const timer = setTimeout(() => { msg.delete().catch(() => {}); }, 15_000);
        timer.unref?.();
      }
    } catch { /* sin permisos para responder: se ignora */ }
  }

  // ═══════════════════════════════════════════════════════════════
  // EJECUCIÓN
  // ═══════════════════════════════════════════════════════════════

  private getJson(command: Command): CommandJson | null {
    if (this.jsonCache.has(command)) return this.jsonCache.get(command)!;
    let json: CommandJson | null = null;
    try {
      json = command.data().toJSON() as unknown as CommandJson;
    } catch (error) {
      this.client.logger.warn(`[Prefix] No se pudo construir el JSON de ${command.name}:`, error);
    }
    this.jsonCache.set(command, json);
    return json;
  }

  private async run(message: Message<true>, command: Command, rest: string, prefix: string, invokedWith: string): Promise<void> {
    const guildId = message.guildId;

    if (command.name === 'help') {
      await this.sendHelp(message, prefix, rest.trim());
      return;
    }

    const interaction = new MessageCommandInteraction({
      client: this.client,
      message,
      commandName: command.name,
      invokedWith: `${invokedWith} ${rest}`.trim(),
    });
    const asSlash = interaction as unknown as ChatInputCommandInteraction;
    const json = this.getJson(command);

    const beforeExecute = async (): Promise<boolean> => {
      if (!json) {
        await replyCommandError(this.client, asSlash, i18n.t('prefix_commands.use_slash_generic', guildId, { command: command.name }));
        return false;
      }

      // Permisos del comando en Discord (en slash los aplica Discord; aquí a mano):
      // overrides de Integraciones y, si no hay, default_member_permissions
      if (!(await this.canUseInDiscord(message, command, json, interaction.memberPermissions.bitfield))) {
        await replyCommandError(this.client, asSlash, i18n.t('command_errors.missing_permissions', guildId));
        return false;
      }

      // NSFW
      if ((json.nsfw || command.nsfw) && !this.isNsfwChannel(message)) {
        await replyCommandError(this.client, asSlash, i18n.t('prefix_commands.nsfw_only', guildId));
        return false;
      }

      if (message.content.length > MAX_CONTENT_LENGTH) {
        await replyCommandError(this.client, asSlash, i18n.t('prefix_commands.errors.too_many_tokens', guildId));
        return false;
      }

      const tokens = tokenize(rest);
      const pathResult = resolveCommandPath(json.options, tokens);
      if (pathResult.ok === false) {
        await this.replyParseError(asSlash, command, json, pathResult.error, prefix, null);
        return false;
      }
      const path = pathResult.path;

      const reason = getPrefixUnsupportedReason(command.name, path.group, path.subcommand);
      if (reason) {
        await this.replyUnsupported(asSlash, command, reason, path.group, path.subcommand);
        return false;
      }

      // Opciones sensibles: nunca por un canal visible
      const rejectSensitive = async (option: string): Promise<false> => {
        const deleted = await message.delete().then(() => true).catch(() => false);
        const note = deleted ? ` ${i18n.t('prefix_commands.message_deleted', guildId)}` : '';
        await replyCommandError(this.client, asSlash,
          i18n.t('prefix_commands.sensitive_option', guildId, { option, command: this.slashPath(command, path.group, path.subcommand) }) + note);
        return false;
      };
      const sensitive = this.findSensitiveOption(path.options, path.rest);
      if (sensitive) return rejectSensitive(sensitive);

      const parsed = parseOptions(path.options, path.rest, message.attachments.size);
      if (parsed.ok) {
        // También si el valor llegó por posición
        const positionalSecret = parsed.options.find(o => o.type === ApplicationCommandOptionType.String && SENSITIVE_OPTION.test(o.name));
        if (positionalSecret) return rejectSensitive(positionalSecret.name);
      }
      if (parsed.ok === false) {
        await this.replyParseError(asSlash, command, json, parsed.error, prefix, path);
        return false;
      }

      // Autocompletado: traducir lo escrito al valor que espera el comando
      const options = await this.applyAutocomplete(interaction, command, path.group, path.subcommand, path.options, parsed.options);

      const unresolved = await interaction.applyOptions(path.group, path.subcommand, path.options, options);
      if (unresolved) {
        await this.replyParseError(asSlash, command, json, { code: 'invalid_value', option: unresolved.option, value: unresolved.value }, prefix, path);
        return false;
      }
      return true;
    };

    const onError = async (error: unknown): Promise<boolean> => {
      if (!(error instanceof PrefixUnsupportedError)) return false;
      // No cobrar el cooldown por algo que no se pudo hacer
      this.client.cooldowns.removeCooldown(command.name, message.author.id);
      const reason: PrefixUnsupportedReason = 'modal';
      const group = interaction.options.getSubcommandGroup(false);
      const sub = interaction.options.getSubcommand(false);
      await this.replyUnsupported(asSlash, command, reason, group, sub);
      return true;
    };

    const afterExecute = (): void => {
      // Paridad con los listeners de interactionCreate de addons que reaccionan
      // al slash /stop (Music Pro: el 24/7 no debe volver a conectar)
      if (command.name === 'stop') {
        (this.client as any)._musicProService?.markManualStop?.(guildId);
      }
    };

    await runChatInputCommand(this.client, asSlash, { beforeExecute, onError, afterExecute }, command);
  }

  /** Permisos de Discord para el comando: Integraciones + default_member_permissions */
  private async canUseInDiscord(message: Message<true>, command: Command, json: CommandJson, memberPermissions: bigint): Promise<boolean> {
    const channel: any = message.channel;
    const params = {
      commandName: json.name ?? command.name,
      channelId: message.channelId,
      parentChannelId: channel.isThread?.() ? channel.parentId : null,
      userId: message.author.id,
      roleIds: [...message.member!.roles.cache.keys()],
      isOwner: message.guild.ownerId === message.author.id,
      memberPermissions,
      defaultMemberPermissions: json.default_member_permissions ?? null,
    };
    try {
      return await this.commandPermissions.canUse(message.guild, params);
    } catch (error) {
      this.client.logger.warn(`[Prefix] Error evaluando permisos de ${command.name}:`, error);
      return hasDefaultMemberPermissions(params.defaultMemberPermissions, memberPermissions);
    }
  }

  private isNsfwChannel(message: Message<true>): boolean {
    const channel: any = message.channel;
    if (channel.isThread?.()) return !!channel.parent?.nsfw;
    return !!channel.nsfw;
  }

  private findSensitiveOption(defs: PrefixOptionDef[], tokens: PrefixToken[]): string | null {
    const sensitive = defs.filter(d => d.type === ApplicationCommandOptionType.String && SENSITIVE_OPTION.test(d.name));
    if (!sensitive.length) return null;
    // Por nombre (password:xxx); los posicionales se revisan tras el parseo
    for (const token of tokens) {
      const hit = token.key && sensitive.find(d => d.name.toLowerCase() === token.key!.toLowerCase());
      if (hit) return hit.name;
    }
    const required = sensitive.find(d => d.required);
    if (required) return required.name;
    return null;
  }

  /**
   * Para opciones con autocompletado, ejecuta el autocompletado del comando con
   * lo escrito y, si hay una coincidencia exacta (o una única coincidencia
   * parcial), usa su valor. Si no, se deja el texto tal cual.
   */
  private async applyAutocomplete(
    interaction: MessageCommandInteraction,
    command: Command,
    group: string | null,
    subcommand: string | null,
    defs: PrefixOptionDef[],
    parsed: ParsedOption[]
  ): Promise<ParsedOption[]> {
    const executeAutocomplete = (command as any).executeAutocomplete;
    if (typeof executeAutocomplete !== 'function') return parsed;
    const defByName = new Map(defs.map(d => [d.name, d]));
    const out = [...parsed];

    for (let i = 0; i < out.length; i++) {
      const opt = out[i];
      const def = defByName.get(opt.name);
      if (!def?.autocomplete) continue;

      const focusedData = out.map((o, idx) => ({
        name: o.name,
        type: o.type,
        value: idx === i ? o.raw : o.value,
        ...(idx === i ? { focused: true } : {}),
      }));
      let data: any[] = focusedData;
      if (subcommand) data = [{ name: subcommand, type: ApplicationCommandOptionType.Subcommand, options: focusedData }];
      if (group) data = [{ name: group, type: ApplicationCommandOptionType.SubcommandGroup, options: data }];

      const auto = new MessageAutocompleteInteraction(
        interaction,
        MessageCommandInteraction.buildResolver(this.client, data, {})
      );
      try {
        await Promise.race([
          executeAutocomplete.call(command, auto),
          new Promise(resolve => setTimeout(resolve, AUTOCOMPLETE_TIMEOUT_MS).unref?.()),
        ]);
      } catch { /* el autocompletado nunca bloquea el comando */ }

      const raw = opt.raw.toLowerCase();
      const exact = auto.choices.find(c => String(c.value).toLowerCase() === raw || c.name.toLowerCase() === raw);
      const partial = auto.choices.filter(c => c.name.toLowerCase().includes(raw) || String(c.value).toLowerCase().includes(raw));
      const choice = exact ?? (partial.length === 1 ? partial[0] : undefined);
      if (!choice) continue;

      const value = def.type === ApplicationCommandOptionType.String ? String(choice.value) : Number(choice.value);
      if (typeof value === 'number' && !Number.isFinite(value)) continue;
      out[i] = { ...opt, value };
    }
    return out;
  }

  private slashPath(command: Command, group: string | null, sub: string | null): string {
    return [command.name, group, sub].filter(Boolean).join(' ');
  }

  private async replyUnsupported(
    interaction: ChatInputCommandInteraction,
    command: Command,
    reason: PrefixUnsupportedReason,
    group: string | null,
    sub: string | null
  ): Promise<void> {
    const key = reason === 'sensitive' ? 'prefix_commands.use_slash_sensitive' : 'prefix_commands.use_slash_modal';
    await replyCommandError(this.client, interaction, i18n.t(key, interaction.guildId!, { command: this.slashPath(command, group, sub) }));
  }

  private async replyParseError(
    interaction: ChatInputCommandInteraction,
    command: Command,
    json: CommandJson,
    error: ParseError,
    prefix: string,
    path: { group: string | null; subcommand: string | null; options: PrefixOptionDef[] } | null
  ): Promise<void> {
    const guildId = interaction.guildId!;
    const vars: Record<string, string> = {
      option: error.option?.name ?? '',
      value: (error.value ?? '').slice(0, 100).replace(/`/g, "'"),
      list: (error.available ?? []).map(s => `\`${s}\``).join(', '),
    };
    let text = i18n.t(`prefix_commands.errors.${error.code}`, guildId, vars);
    if (error.code === 'invalid_value' && !error.option) text = i18n.t('prefix_commands.errors.invalid_value_generic', guildId);

    if (path) {
      const usage = `${prefix}${[command.name, path.group, path.subcommand].filter(Boolean).join(' ')} ${formatUsageArgs(path.options)}`.trim();
      text += `\n${i18n.t('prefix_commands.usage', guildId, { usage: `\`${usage}\`` })}`;
    } else if (json.options?.length) {
      text += `\n${i18n.t('prefix_commands.usage_hint', guildId, { prefix, command: command.name })}`;
    }
    await replyCommandError(this.client, interaction, text);
  }

  // ═══════════════════════════════════════════════════════════════
  // AYUDA (<prefijo>help [comando])
  // ═══════════════════════════════════════════════════════════════

  /** Comandos que este usuario puede usar con prefijo aquí */
  private async availableCommands(message: Message<true>): Promise<Command[]> {
    const member = message.member!;
    const perms = member.permissionsIn(message.channel.id);
    const unique = new Map<string, Command>();
    for (const command of this.client.commands.getEnabledCommands()) unique.set(command.name, command);

    const result: Command[] = [];
    for (const command of unique.values()) {
      if (isFullyUnsupported(command.name)) continue;
      const json = this.getJson(command);
      if (!json) continue;
      if (!(await this.canUseInDiscord(message, command, json, perms.bitfield))) continue;
      const check = await command.canExecute(message.author.id, message.guildId, perms.bitfield).catch(() => ({ canExecute: false }));
      if (!check.canExecute) continue;
      result.push(command);
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  private categoryLabel(category: string, guildId: string): string {
    const key = `commands.help.cat_${category}`;
    const label = i18n.t(key, guildId);
    return label && label !== key ? label : category;
  }

  private async sendHelp(message: Message<true>, prefix: string, query: string): Promise<void> {
    const guildId = message.guildId;
    const reply = async (embed: EmbedBuilder) => {
      await message.reply({ embeds: [embed], allowedMentions: SAFE_ALLOWED_MENTIONS, failIfNotExists: false }).catch(() => {});
    };

    if (query) {
      const name = query.split(/\s+/)[0].toLowerCase().replace(prefix.toLowerCase(), '');
      const command = this.client.commands.getCommand(name.startsWith('/') ? name.slice(1) : name);
      if (!command || !command.enabled) {
        await this.sendPlain(message, `❌ ${i18n.t('prefix_commands.help.not_found', guildId, { name: name.slice(0, 50).replace(/`/g, "'") })}`, true);
        return;
      }
      await reply(this.commandHelpEmbed(command, prefix, guildId));
      return;
    }

    const commands = await this.availableCommands(message);
    const embed = new EmbedBuilder()
      .setColor(0x00d9ff)
      .setTitle(i18n.t('prefix_commands.help.title', guildId))
      .setDescription(i18n.t('prefix_commands.help.description', guildId, { prefix }));

    if (!commands.length) {
      embed.addFields({ name: '​', value: i18n.t('prefix_commands.help.none', guildId) });
      await reply(embed);
      return;
    }

    const byCategory = new Map<string, Command[]>();
    for (const command of commands) {
      const list = byCategory.get(command.category) ?? [];
      list.push(command);
      byCategory.set(command.category, list);
    }

    let hasPartial = false;
    const categories = [...byCategory.keys()].sort();
    for (const category of categories.slice(0, 25)) {
      const names = byCategory.get(category)!.map(c => {
        const partial = isPartiallyUnsupported(c.name);
        if (partial) hasPartial = true;
        return `\`${prefix}${c.name}\`${partial ? '*' : ''}`;
      });
      let value = '';
      for (let i = 0; i < names.length; i++) {
        const next = value ? `${value} ${names[i]}` : names[i];
        if (next.length > 980) {
          value += ` ${i18n.t('prefix_commands.help.more', guildId, { count: String(names.length - i) })}`;
          break;
        }
        value = next;
      }
      embed.addFields({ name: this.categoryLabel(category, guildId), value });
    }

    const footer = [i18n.t('prefix_commands.help.footer', guildId, { count: String(commands.length), prefix })];
    if (hasPartial) footer.push(i18n.t('prefix_commands.help.partial_note', guildId));
    embed.setFooter({ text: footer.join(' · ').slice(0, 2048) });
    await reply(embed);
  }

  private commandHelpEmbed(command: Command, prefix: string, guildId: string): EmbedBuilder {
    const json = this.getJson(command);
    const descKey = `commands.${command.name}.description`;
    const translated = i18n.t(descKey, guildId);
    const description = translated && translated !== descKey ? translated : command.description;

    const embed = new EmbedBuilder()
      .setColor(0x00d9ff)
      .setTitle(i18n.t('prefix_commands.help.command_title', guildId, { prefix, command: command.name }))
      .setDescription(description.slice(0, 1000));

    if (!json || isFullyUnsupported(command.name)) {
      embed.addFields({ name: i18n.t('prefix_commands.help.usage_field', guildId), value: i18n.t('prefix_commands.help.slash_only_command', guildId, { command: command.name }) });
      return embed;
    }

    const lines: string[] = [];
    for (const entry of listCommandPaths(json.options)) {
      const [group, sub] = entry.path.includes(' ') ? entry.path.split(' ') : [null, entry.path || null];
      const unsupported = getPrefixUnsupportedReason(command.name, group, sub);
      const head = `${prefix}${[command.name, entry.path].filter(Boolean).join(' ')}`;
      lines.push(unsupported
        ? `\`/${[command.name, entry.path].filter(Boolean).join(' ')}\` — ${i18n.t('prefix_commands.help.slash_only', guildId)}`
        : `\`${`${head} ${formatUsageArgs(entry.options)}`.trim()}\``);
    }

    let value = '';
    for (let i = 0; i < lines.length; i++) {
      const next = value ? `${value}\n${lines[i]}` : lines[i];
      if (next.length > 3900) {
        value += `\n${i18n.t('prefix_commands.help.more', guildId, { count: String(lines.length - i) })}`;
        break;
      }
      value = next;
    }
    embed.setDescription(`${description.slice(0, 1000)}\n\n**${i18n.t('prefix_commands.help.usage_field', guildId)}**\n${value}`.slice(0, 4096));

    if (command.aliases.length) {
      embed.addFields({ name: i18n.t('prefix_commands.help.aliases', guildId), value: command.aliases.map(a => `\`${prefix}${a}\``).join(' ').slice(0, 1024) });
    }
    embed.setFooter({ text: i18n.t('prefix_commands.help.syntax_footer', guildId) });
    return embed;
  }
}
