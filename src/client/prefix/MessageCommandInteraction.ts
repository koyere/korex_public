import {
  ApplicationCommandOptionChoiceData,
  ApplicationCommandOptionType,
  ApplicationCommandType,
  Attachment,
  Collection,
  CommandInteractionOption,
  CommandInteractionOptionResolver,
  GuildBasedChannel,
  GuildMember,
  InteractionType,
  Message,
  MessageFlags,
  MessageFlagsBitField,
  MessageMentionOptions,
  MessagePayload,
  PermissionFlagsBits,
  PermissionsBitField,
  Role,
  User,
} from 'discord.js';
import { KorexClient } from '../KorexClient';
import { ParsedOption, PrefixOptionDef } from './ArgumentParser';

/**
 * The command does something a text message cannot do (open a modal,
 * await a modal submission…). The prefix handler turns it into a
 * "use the slash version" notice and refunds the cooldown.
 */
export class PrefixUnsupportedError extends Error {
  constructor(public readonly feature: string) {
    super(`PREFIX_UNSUPPORTED:${feature}`);
    this.name = 'PrefixUnsupportedError';
  }
}

/** Errors equivalent to discord.js ones for duplicate replies */
class PrefixInteractionStateError extends Error {
  constructor(public readonly code: 'InteractionAlreadyReplied' | 'InteractionNotReplied') {
    super(code === 'InteractionAlreadyReplied'
      ? 'The reply to this interaction has already been sent or deferred.'
      : 'The reply to this interaction has not been sent or deferred.');
    this.name = 'PrefixInteractionStateError';
  }
}

/** Safe mentions: never @everyone/@here or roles; no ping to the command author */
export const SAFE_ALLOWED_MENTIONS: MessageMentionOptions = { parse: ['users'], repliedUser: false };

/** "Ephemeral" replies (without components) are deleted from the channel after this time */
const EPHEMERAL_DELETE_MS = 60_000;

/** Message flags that can be kept when converting from interaction to message */
const KEEP_FLAGS = MessageFlags.SuppressEmbeds | MessageFlags.SuppressNotifications | MessageFlags.IsComponentsV2;

function sanitizeMentions(input?: MessageMentionOptions): MessageMentionOptions {
  if (!input) return SAFE_ALLOWED_MENTIONS;
  return {
    parse: (input.parse ?? []).filter(p => p === 'users'),
    users: input.users,
    roles: [],
    repliedUser: false,
  };
}

interface NormalizedPayload {
  payload: Record<string, any>;
  ephemeral: boolean;
  wantsResponse: boolean;
  withResponse: boolean;
}

/**
 * Converts an interaction's reply/editReply/followUp options into
 * regular message options (no ephemeral, no TTS, safe mentions).
 */
export function normalizeReplyOptions(options: unknown): NormalizedPayload {
  let raw: Record<string, any>;
  if (typeof options === 'string') raw = { content: options };
  else if (options instanceof MessagePayload) raw = { ...(options.options as Record<string, any>) };
  else raw = { ...((options as Record<string, any>) ?? {}) };

  let flagBits = 0;
  try {
    flagBits = raw.flags !== undefined && raw.flags !== null ? Number(MessageFlagsBitField.resolve(raw.flags)) : 0;
  } catch {
    flagBits = 0;
  }
  const ephemeral = raw.ephemeral === true || (flagBits & MessageFlags.Ephemeral) === MessageFlags.Ephemeral;
  const wantsResponse = raw.fetchReply === true || raw.withResponse === true;
  const withResponse = raw.withResponse === true;

  const payload: Record<string, any> = {};
  for (const key of ['content', 'embeds', 'components', 'files', 'attachments', 'poll']) {
    if (raw[key] !== undefined) payload[key] = raw[key];
  }
  const kept = flagBits & KEEP_FLAGS;
  if (kept) payload.flags = kept;
  payload.allowedMentions = sanitizeMentions(raw.allowedMentions);

  return { payload, ephemeral, wantsResponse, withResponse };
}

function hasComponents(payload: Record<string, any>, message?: Message | null): boolean {
  if (Array.isArray(payload.components)) return payload.components.length > 0;
  return !!message && message.components.length > 0;
}

export interface MessageInteractionInit {
  client: KorexClient;
  message: Message<true>;
  commandName: string;
  /** Text it was invoked with (for logs/toString) */
  invokedWith: string;
}

/**
 * "Message interaction": implements the part of ChatInputCommandInteraction
 * that commands use, starting from a prefixed message. Replies are
 * translated into channel messages (replying to the original message).
 *
 *  - reply/editReply/followUp/fetchReply/deleteReply → channel messages.
 *  - deferReply → "typing…" indicator.
 *  - Ephemeral → via DM to the user (✉️ on the original message). If DMs are
 *    closed, or the reply has components, in the channel: it deletes itself after
 *    a minute if it has no components (if it has them, it is kept for the buttons).
 *  - showModal/awaitModalSubmit → PrefixUnsupportedError.
 */
export class MessageCommandInteraction {
  public readonly client: KorexClient;
  public readonly message: Message<true>;
  public readonly id: string;
  public readonly type = InteractionType.ApplicationCommand;
  public readonly commandType = ApplicationCommandType.ChatInput;
  public readonly commandName: string;
  public readonly commandId: string | null = null;
  public readonly commandGuildId: string | null = null;
  public readonly applicationId: string;
  public readonly user: User;
  public readonly member: GuildMember;
  public readonly guild: Message<true>['guild'];
  public readonly guildId: string;
  public readonly channel: Message<true>['channel'];
  public readonly channelId: string;
  public readonly memberPermissions: Readonly<PermissionsBitField>;
  public readonly appPermissions: Readonly<PermissionsBitField>;
  public readonly locale: string;
  public readonly guildLocale: string;
  public readonly createdTimestamp: number;
  public readonly token = '';
  public readonly version = 1;
  /** Marker so any code can tell where it came from */
  public readonly isPrefixCommand = true;

  public options: CommandInteractionOptionResolver;
  public replied = false;
  public deferred = false;
  public ephemeral: boolean | null = null;

  private readonly invokedWith: string;
  private replyMessage: Message | null = null;
  private deleteTimers = new Map<string, NodeJS.Timeout>();
  /** The DM to the user failed (DMs closed…): remaining ephemerals go to the channel */
  private dmFailed = false;
  private dmNotified = false;

  constructor(init: MessageInteractionInit) {
    this.client = init.client;
    this.message = init.message;
    this.id = init.message.id;
    this.commandName = init.commandName;
    this.invokedWith = init.invokedWith;
    this.applicationId = init.client.user?.id ?? '';
    this.user = init.message.author;
    this.member = init.message.member!;
    this.guild = init.message.guild;
    this.guildId = init.message.guildId;
    this.channel = init.message.channel;
    this.channelId = init.message.channelId;
    this.memberPermissions = this.member.permissionsIn(this.channel.id);
    const me = this.guild.members.me;
    this.appPermissions = me ? me.permissionsIn(this.channel.id) : new PermissionsBitField();
    this.guildLocale = this.guild.preferredLocale;
    this.locale = this.guild.preferredLocale;
    this.createdTimestamp = init.message.createdTimestamp;
    this.options = MessageCommandInteraction.buildResolver(init.client, [], {});
  }

  get createdAt(): Date {
    return new Date(this.createdTimestamp);
  }

  get command(): null {
    return null;
  }

  // ── Type guards (as in discord.js) ──────────────────────────────────────
  isChatInputCommand(): boolean { return true; }
  isCommand(): boolean { return true; }
  isRepliable(): boolean { return true; }
  inGuild(): boolean { return true; }
  inCachedGuild(): boolean { return true; }
  inRawGuild(): boolean { return false; }
  isAutocomplete(): boolean { return false; }
  isButton(): boolean { return false; }
  isAnySelectMenu(): boolean { return false; }
  isSelectMenu(): boolean { return false; }
  isStringSelectMenu(): boolean { return false; }
  isUserSelectMenu(): boolean { return false; }
  isRoleSelectMenu(): boolean { return false; }
  isChannelSelectMenu(): boolean { return false; }
  isMentionableSelectMenu(): boolean { return false; }
  isMessageComponent(): boolean { return false; }
  isModalSubmit(): boolean { return false; }
  isContextMenuCommand(): boolean { return false; }
  isUserContextMenuCommand(): boolean { return false; }
  isMessageContextMenuCommand(): boolean { return false; }
  isPrimaryEntryPointCommand(): boolean { return false; }

  toString(): string {
    return this.invokedWith;
  }

  // ── Options ──────────────────────────────────────────────────────────────
  /** Creates a real discord.js CommandInteractionOptionResolver */
  static buildResolver(client: KorexClient, data: CommandInteractionOption[], resolved: Record<string, unknown>): CommandInteractionOptionResolver {
    const Resolver = CommandInteractionOptionResolver as unknown as new (
      c: unknown, o: CommandInteractionOption[], r: Record<string, unknown>
    ) => CommandInteractionOptionResolver;
    return new Resolver(client, data, resolved);
  }

  /**
   * Resolves the parsed options (IDs → User/GuildMember/Role/Channel,
   * indexes → Attachment) and builds the resolver. Everything scoped to this server.
   * Returns the option that could not be resolved, or null if all went well.
   */
  async applyOptions(
    group: string | null,
    subcommand: string | null,
    defs: PrefixOptionDef[],
    parsed: ParsedOption[]
  ): Promise<{ option: PrefixOptionDef; value: string } | null> {
    const resolved = {
      users: new Collection<string, User>(),
      members: new Collection<string, GuildMember>(),
      roles: new Collection<string, Role>(),
      channels: new Collection<string, GuildBasedChannel>(),
      attachments: new Collection<string, Attachment>(),
      messages: new Collection<string, Message>(),
    };
    const hoisted: CommandInteractionOption[] = [];
    const defByName = new Map(defs.map(d => [d.name, d]));

    for (const opt of parsed) {
      const def = defByName.get(opt.name)!;
      const out: CommandInteractionOption = { name: opt.name, type: opt.type, value: opt.value };
      const id = String(opt.value);

      switch (opt.type) {
        case ApplicationCommandOptionType.User: {
          const user = await this.fetchUser(id);
          if (!user) return { option: def, value: opt.raw };
          out.user = user;
          resolved.users.set(user.id, user);
          const member = await this.fetchMember(id);
          if (member) { out.member = member as any; resolved.members.set(member.id, member); }
          break;
        }
        case ApplicationCommandOptionType.Role: {
          const role = await this.fetchRole(id);
          if (!role) return { option: def, value: opt.raw };
          out.role = role;
          resolved.roles.set(role.id, role);
          break;
        }
        case ApplicationCommandOptionType.Channel: {
          const channel = await this.fetchChannel(id);
          if (!channel) return { option: def, value: opt.raw };
          if (def.channel_types?.length && !def.channel_types.includes(channel.type)) return { option: def, value: opt.raw };
          out.channel = channel as any;
          resolved.channels.set(channel.id, channel);
          break;
        }
        case ApplicationCommandOptionType.Mentionable: {
          const role = opt.mentionKind !== 'user' ? await this.fetchRole(id) : null;
          if (role) {
            out.role = role;
            resolved.roles.set(role.id, role);
            break;
          }
          const user = opt.mentionKind !== 'role' ? await this.fetchUser(id) : null;
          if (!user) return { option: def, value: opt.raw };
          out.user = user;
          resolved.users.set(user.id, user);
          const member = await this.fetchMember(id);
          if (member) { out.member = member as any; resolved.members.set(member.id, member); }
          break;
        }
        case ApplicationCommandOptionType.Attachment: {
          const attachment = this.message.attachments.at(opt.attachmentIndex ?? 0);
          if (!attachment) return { option: def, value: opt.raw };
          out.value = attachment.id;
          out.attachment = attachment;
          resolved.attachments.set(attachment.id, attachment);
          break;
        }
        default:
          break;
      }
      hoisted.push(out);
    }

    let data: CommandInteractionOption[] = hoisted;
    if (subcommand) data = [{ name: subcommand, type: ApplicationCommandOptionType.Subcommand, options: hoisted }];
    if (group) data = [{ name: group, type: ApplicationCommandOptionType.SubcommandGroup, options: data }];

    this.options = MessageCommandInteraction.buildResolver(this.client, data, resolved);
    return null;
  }

  private async fetchUser(id: string): Promise<User | null> {
    return this.client.users.cache.get(id) ?? await this.client.users.fetch(id).catch(() => null);
  }

  private async fetchMember(id: string): Promise<GuildMember | null> {
    return this.guild.members.cache.get(id) ?? await this.guild.members.fetch(id).catch(() => null);
  }

  private async fetchRole(id: string): Promise<Role | null> {
    // Only roles from THIS server
    return this.guild.roles.cache.get(id) ?? await this.guild.roles.fetch(id).catch(() => null);
  }

  private async fetchChannel(id: string): Promise<GuildBasedChannel | null> {
    // Only channels (and threads) from THIS server
    const cached = this.guild.channels.cache.get(id);
    if (cached) return cached;
    const fetched = await this.guild.channels.fetch(id).catch(() => null);
    if (fetched) return fetched;
    const thread = await this.client.channels.fetch(id).catch(() => null);
    return thread && 'guildId' in thread && (thread as GuildBasedChannel).guildId === this.guildId
      ? (thread as GuildBasedChannel)
      : null;
  }

  // ── Replies ────────────────────────────────────────────────────────────
  private canReplyReference(): boolean {
    return this.appPermissions.has(PermissionFlagsBits.ReadMessageHistory);
  }

  /** Message in the channel (as a reply to the original message when possible) */
  private async sendInitial(payload: Record<string, any>): Promise<Message> {
    if (this.canReplyReference()) {
      return this.message.reply({ ...payload, failIfNotExists: false } as any);
    }
    return (this.channel as any).send(payload);
  }

  private isDm(msg: Message | null): boolean {
    return !!msg && !msg.inGuild();
  }

  /**
   * Delivers a reply. Ephemerals without components go via DM to the user
   * (component handlers need the server context, which does not exist
   * in a DM, so those with components stay in the channel).
   * If the DM fails (50007: DMs closed, or another error) → channel, as before.
   */
  private async deliver(payload: Record<string, any>, ephemeral: boolean, initial: boolean): Promise<Message> {
    if (ephemeral && !hasComponents(payload) && !this.dmFailed) {
      try {
        const msg = await this.user.send(payload as any);
        this.markDmSent();
        return msg;
      } catch {
        this.dmFailed = true;
      }
    }
    return initial ? this.sendInitial(payload) : (this.channel as any).send(payload);
  }

  /** Discreet notice on the original message: ✉️ (only once) */
  private markDmSent(): void {
    if (this.dmNotified) return;
    this.dmNotified = true;
    if (this.appPermissions.has(PermissionFlagsBits.AddReactions) && this.appPermissions.has(PermissionFlagsBits.ReadMessageHistory)) {
      this.message.react('✉️').catch(() => {});
    }
  }

  private scheduleEphemeralDelete(msg: Message, ephemeral: boolean, payload: Record<string, any>): void {
    const existing = this.deleteTimers.get(msg.id);
    if (existing) clearTimeout(existing);
    this.deleteTimers.delete(msg.id);
    // Nothing is deleted in the DM; in the channel, only ephemerals without components
    if (!ephemeral || this.isDm(msg) || hasComponents(payload, msg)) return;
    const timer = setTimeout(() => {
      this.deleteTimers.delete(msg.id);
      msg.delete().catch(() => {});
    }, EPHEMERAL_DELETE_MS);
    timer.unref?.();
    this.deleteTimers.set(msg.id, timer);
  }

  private responseFor(msg: Message, normalized: NormalizedPayload): any {
    if (normalized.withResponse) {
      return { interaction: this, resource: { type: 4, message: msg } };
    }
    return msg;
  }

  async reply(options: unknown): Promise<any> {
    if (this.replied || this.deferred) throw new PrefixInteractionStateError('InteractionAlreadyReplied');
    const normalized = normalizeReplyOptions(options);
    this.ephemeral = normalized.ephemeral;
    const msg = await this.deliver(normalized.payload, normalized.ephemeral, true);
    this.replyMessage = msg;
    this.replied = true;
    this.scheduleEphemeralDelete(msg, normalized.ephemeral, normalized.payload);
    return this.responseFor(msg, normalized);
  }

  async deferReply(options?: unknown): Promise<any> {
    if (this.replied || this.deferred) throw new PrefixInteractionStateError('InteractionAlreadyReplied');
    const normalized = normalizeReplyOptions(options ?? {});
    this.ephemeral = normalized.ephemeral;
    this.deferred = true;
    await (this.channel as any).sendTyping?.().catch(() => {});
    if (normalized.wantsResponse) {
      const msg = await this.fetchReply();
      return this.responseFor(msg, normalized);
    }
    return undefined;
  }

  async editReply(options: unknown): Promise<Message> {
    if (!this.replied && !this.deferred) throw new PrefixInteractionStateError('InteractionNotReplied');
    const normalized = normalizeReplyOptions(options);
    const ephemeral = this.ephemeral === true;
    let msg: Message;
    if (this.replyMessage && this.isDm(this.replyMessage) && hasComponents(normalized.payload)) {
      // The DM reply now has components: move it to the channel
      const previous = this.replyMessage;
      msg = await this.sendInitial(normalized.payload);
      previous.delete().catch(() => {});
    } else if (this.replyMessage) {
      const editPayload = { ...normalized.payload };
      // On edit, flags only allow SuppressEmbeds/IsComponentsV2
      if (editPayload.flags !== undefined) editPayload.flags = Number(editPayload.flags) & (MessageFlags.SuppressEmbeds | MessageFlags.IsComponentsV2);
      delete editPayload.poll;
      msg = await this.replyMessage.edit(editPayload as any);
    } else {
      msg = await this.deliver(normalized.payload, ephemeral, true);
    }
    this.replyMessage = msg;
    this.replied = true;
    this.scheduleEphemeralDelete(msg, ephemeral, normalized.payload);
    return msg;
  }

  async fetchReply(): Promise<Message> {
    if (this.replyMessage) return this.replyMessage;
    if (!this.deferred) throw new PrefixInteractionStateError('InteractionNotReplied');
    // Deferred with no reply yet: create the message that will be edited later
    const msg = await this.deliver({ content: '⏳', allowedMentions: SAFE_ALLOWED_MENTIONS }, this.ephemeral === true, true);
    this.replyMessage = msg;
    return msg;
  }

  async deleteReply(): Promise<void> {
    if (!this.replyMessage) throw new PrefixInteractionStateError('InteractionNotReplied');
    const msg = this.replyMessage;
    this.replyMessage = null;
    const timer = this.deleteTimers.get(msg.id);
    if (timer) clearTimeout(timer);
    this.deleteTimers.delete(msg.id);
    await msg.delete();
  }

  async followUp(options: unknown): Promise<any> {
    if (!this.replied && !this.deferred) throw new PrefixInteractionStateError('InteractionNotReplied');
    const normalized = normalizeReplyOptions(options);
    // Deferred with no reply: the first followUp acts as the reply (as in Discord)
    const initial = !this.replyMessage;
    const msg = await this.deliver(normalized.payload, normalized.ephemeral, initial);
    if (initial) {
      this.replyMessage = msg;
      this.replied = true;
    }
    this.scheduleEphemeralDelete(msg, normalized.ephemeral, normalized.payload);
    return this.responseFor(msg, normalized);
  }

  // ── Not available from a message ───────────────────────────────────────
  async showModal(): Promise<never> {
    throw new PrefixUnsupportedError('modal');
  }

  async awaitModalSubmit(): Promise<never> {
    throw new PrefixUnsupportedError('modal');
  }

  async launchActivity(): Promise<never> {
    throw new PrefixUnsupportedError('activity');
  }

  async sendPremiumRequired(): Promise<never> {
    throw new PrefixUnsupportedError('premium_required');
  }
}

/**
 * Synthetic autocomplete interaction: allows reusing the command's
 * `executeAutocomplete` to translate what the user typed
 * (e.g. a name) into the value the command expects (e.g. an ID).
 */
export class MessageAutocompleteInteraction {
  public readonly type = InteractionType.ApplicationCommandAutocomplete;
  public readonly commandType = ApplicationCommandType.ChatInput;
  public responded = false;
  public choices: ApplicationCommandOptionChoiceData[] = [];
  public readonly isPrefixCommand = true;

  constructor(
    private readonly base: MessageCommandInteraction,
    public readonly options: CommandInteractionOptionResolver
  ) {}

  get client() { return this.base.client; }
  get id() { return this.base.id; }
  get commandName() { return this.base.commandName; }
  get commandId() { return null; }
  get user() { return this.base.user; }
  get member() { return this.base.member; }
  get guild() { return this.base.guild; }
  get guildId() { return this.base.guildId; }
  get channel() { return this.base.channel; }
  get channelId() { return this.base.channelId; }
  get memberPermissions() { return this.base.memberPermissions; }
  get appPermissions() { return this.base.appPermissions; }
  get locale() { return this.base.locale; }
  get guildLocale() { return this.base.guildLocale; }

  isAutocomplete(): boolean { return true; }
  isChatInputCommand(): boolean { return false; }
  isRepliable(): boolean { return false; }
  inGuild(): boolean { return true; }
  inCachedGuild(): boolean { return true; }

  async respond(choices: readonly ApplicationCommandOptionChoiceData[]): Promise<void> {
    if (this.responded) throw new PrefixInteractionStateError('InteractionAlreadyReplied');
    this.responded = true;
    this.choices = [...choices];
  }
}
