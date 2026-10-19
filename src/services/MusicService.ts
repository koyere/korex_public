/**
 * MusicService — discord-player + discord-player-youtubei
 *
 * Public interface is intentionally identical to the previous Lavalink-based
 * implementation so that all commands, components and the health monitor
 * continue to work without changes.
 *
 * LAVALINK FALLBACK NOTE:
 * Lavalink is not used by default. If youtube-source ever gains reliable
 * cookie/OAuth support, the Lavalink path can be restored by:
 *   1. Starting a Lavalink node with your own application.yml
 *   2. Reverting this file to the lavalink-client implementation
 *   3. Re-adding lavalink-client to package.json
 */

import {
  GuildMember,
  TextChannel,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import https from 'https';
import http from 'http';
import { Player, GuildQueue, Track, BaseExtractor, QueryType, Util } from 'discord-player';
import { SoundCloudExtractor, AttachmentExtractor } from '@discord-player/extractor';
import { isPublicHttpUrl } from '../utils/safeUrl';
import { i18n } from '../utils/i18n';

const DIRECT_AUDIO_RE = /\.(mp3|wav|ogg|flac|m4a|aac|opus)(\?.*)?$/i;

function fetchStream(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('http://') ? http : https;
    lib.get(url, (res) => resolve(res)).once('error', reject);
  });
}

// Handles direct audio URLs (e.g. S3) that serve binary/octet-stream content-type,
// which AttachmentExtractor rejects. Runs at higher priority so it intercepts first.
class DirectAudioExtractor extends BaseExtractor {
  static override identifier = 'com.korex.directaudio';
  priority = 1;

  async validate(query: string, type?: string | null): Promise<boolean> {
    return type === (QueryType.ARBITRARY as string) && typeof query === 'string' && DIRECT_AUDIO_RE.test(query.split('?')[0]);
  }

  async handle(query: string, context: any) {
    let durationMs = 0;

    try {
      const stream = await fetchStream(query);
      const mediaplex = require('mediaplex');
      const probeTimeout = this.context.player.options?.probeTimeout ?? 5000;
      const { result, stream: probeStream } = await Promise.race<any>([
        mediaplex.probeStream(stream),
        new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), probeTimeout)),
      ]);
      if (result?.duration) durationMs = result.duration * 1000;
      probeStream?.destroy?.();
    } catch {
      // probing failed — duration stays 0
    }

    const track = new Track(this.context.player, {
      title: 'AI Generated Music',
      url: query,
      duration: Util.buildTimeCode(Util.parseMS(durationMs)),
      description: 'AI Generated Music',
      thumbnail: 'https://upload.wikimedia.org/wikipedia/commons/2/2a/ITunes_12.2_logo.png',
      views: 0,
      author: 'AI Music',
      requestedBy: context.requestedBy,
      source: 'arbitrary' as any,
      engine: query,
      queryType: context.type,
      metadata: { url: query },
      async requestMetadata() { return { url: query }; },
    });
    track.extractor = this;
    (track as any).raw.isFile = false;
    return { playlist: null, tracks: [track] };
  }

  async stream(track: Track): Promise<string> {
    return track.url;
  }

  async getRelatedTracks() {
    return this.createResponse();
  }
}
import { KorexClient } from '../client/KorexClient';
import { createLogger } from '../utils/Logger';
import fs from 'fs';
import path from 'path';

// ─── Public types (unchanged from Lavalink implementation) ───────────────────

export interface MusicConfig {
  enabled: boolean;
  djRoleId: string | null;
  djOnly: boolean;
  maxQueueSize: number;
  maxSongDuration: number;
  defaultVolume: number;
  announceNowPlaying: boolean;
  restrictedChannels: string[];
  voteSkipEnabled: boolean;
  voteSkipThreshold: number; // % of listeners required
}

export interface MusicTrackView {
  title: string;
  artist: string;
  duration: number;
  requestedBy: { id: string; displayName: string; mention: string };
  thumbnail: string | null;
  source: string;
  uri: string;
}

export interface MusicQueueView {
  tracks: MusicTrackView[];
  currentTrack: MusicTrackView | null;
  voiceChannel: { id: string } | null;
  paused: boolean;
  volume: number;
  loop: 'none' | 'track' | 'queue';
}

export interface MusicPlayResult {
  track: MusicTrackView;
  started: boolean;
  queueSize: number;
}

export interface MusicStats {
  totalTracks: number;
  totalPlaytime: number;
  activeUsers: number;
  topTracks: string[];
  topUsers: string[];
}

export interface MusicQueueDisplay {
  tracks: Array<MusicTrackView & { position: number }>;
  currentTrack: MusicTrackView | null;
  currentPage: number;
  totalPages: number;
  totalTracks: number;
  page: number;
  volume: number;
  paused: boolean;
  loop: 'none' | 'track' | 'queue';
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class MusicService {
  private client: KorexClient;
  private logger: ReturnType<typeof createLogger>;
  private player: Player | null = null;
  private initialized = false;
  // Start of the playback session per server (queue created → queue deleted)
  private sessionStart = new Map<string, number>();

  constructor(client: KorexClient) {
    this.client = client;
    this.logger = createLogger('music');

    if (process.env.MUSIC_ENABLED !== 'true') {
      this.logger.info('Music system is disabled in configuration');
      return;
    }

    try {
      this.player = new Player(client as any, {
        skipFFmpeg: false,
      });
      this.setupEvents();
      this.initialized = true;
      this.logger.info('🎵 MusicService initialised (discord-player + youtubei)');
    } catch (err) {
      this.logger.error('Error initialising MusicService:', err);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  public async init(): Promise<void> {
    if (!this.player) return;
    // SoundCloud only — YoutubeiExtractor is NOT registered because many hosting
    // provider IPs are blocked by YouTube for streaming (400 on player API + decipher failure).
    // Registering it causes discord-player to call it as a fallback stream provider
    // even for SoundCloud tracks, breaking playback.
    // TODO: re-enable YoutubeiExtractor when proxy/IP rotation is available for premium.
    await this.player.extractors.register(SoundCloudExtractor, {});
    await this.player.extractors.register(AttachmentExtractor, {});
    await this.player.extractors.register(DirectAudioExtractor, {});
    this.logger.info('🎵 SoundCloudExtractor + AttachmentExtractor + DirectAudioExtractor registered');
  }

  public async initialize(): Promise<void> {
    await this.init();
  }

  public isEnabled(): boolean {
    return this.initialized && !!this.player;
  }

  public isReady(): boolean {
    return this.initialized && !!this.player;
  }

  /** No-op — kept for compatibility with the raw event handler (now unused) */
  public updateVoiceState(_packet: unknown): void {}

  // ── Playback ───────────────────────────────────────────────────────────────

  public async play(
    member: GuildMember,
    channel: TextChannel,
    query: string,
    limits?: { maxQueueSize?: number; maxTrackDuration?: number },
    titleOverride?: string,
  ): Promise<MusicPlayResult> {
    if (!this.player) throw new Error('MUSIC_NODE_UNAVAILABLE');
    if (!member.voice.channel) throw new Error('MUSIC_NOT_IN_VOICE');

    const existingQueue = this.queueOf(member.guild.id);
    if (existingQueue && existingQueue.channel?.id !== member.voice.channel.id) {
      throw new Error('MUSIC_DIFFERENT_VOICE_CHANNEL');
    }

    const guildId = member.guild.id;
    const isUrl = query.startsWith('http://') || query.startsWith('https://');

    // SSRF: a direct URL must not point to the host's internal network
    if (isUrl && !(await isPublicHttpUrl(query))) {
      throw new Error('MUSIC_URL_NOT_ALLOWED');
    }
    // Only SoundCloud, attachments and direct audio: YouTube/Spotify are not supported
    if (isUrl && /(youtube\.com|youtu\.be|spotify\.com|music\.apple\.com|deezer\.com)/i.test(query)) {
      throw new Error('MUSIC_UNSUPPORTED_SOURCE');
    }

    const musicConfig = await this.getMusicConfig(guildId);
    const resolvedQuery = isUrl ? query : `scsearch:${query.replace(/^sc:/, '')}`;

    // Direct audio URLs (e.g. S3 .mp3) bypass SoundCloud search entirely
    const isDirectAudio = isUrl && /\.(mp3|wav|ogg|flac|m4a|aac|opus)(\?.*)?$/i.test(resolvedQuery);
    const engine = isDirectAudio
      ? QueryType.ARBITRARY
      : isUrl ? QueryType.AUTO : QueryType.SOUNDCLOUD_SEARCH;

    // Search explicitly with forced source — no implicit fallback to YouTube
    const searchResult = await this.player.search(resolvedQuery, {
      requestedBy: member.user,
      searchEngine: engine,
    });

    // Filter out MONETIZE tracks (require SC OAuth to stream — will fail silently)
    const playableTracks = searchResult.tracks.filter(t => {
      const raw = (t as any).raw;
      return !raw?.policy || raw.policy === 'ALLOW' || raw.policy === 'SNIP';
    });

    const trackToPlay = playableTracks[0] ?? searchResult.tracks[0];
    if (!trackToPlay) throw new Error('MUSIC_NO_RESULTS');

    if (titleOverride) (trackToPlay as any).title = titleOverride;

    // Limits: Music Pro's (if the addon is active) or the dashboard's
    limits = {
      maxQueueSize: limits?.maxQueueSize || musicConfig.maxQueueSize,
      maxTrackDuration: limits?.maxTrackDuration || musicConfig.maxSongDuration,
    };
    if (limits.maxQueueSize && limits.maxQueueSize > 0) {
      const existingQ = this.queueOf(guildId);
      const currentSize = (existingQ?.tracks.size ?? 0) + (existingQ?.currentTrack ? 1 : 0);
      if (currentSize >= limits.maxQueueSize) {
        throw new Error(`QUEUE_FULL:${limits.maxQueueSize}`);
      }
    }

    if (limits?.maxTrackDuration && limits.maxTrackDuration > 0) {
      const durationSec = Math.floor((trackToPlay.durationMS ?? 0) / 1000);
      if (durationSec > limits.maxTrackDuration) {
        throw new Error(`TRACK_TOO_LONG:${limits.maxTrackDuration}:${durationSec}`);
      }
    }

    // If nothing was playing, /play already announces this track: avoid a double notice
    if (!this.queueOf(guildId)?.currentTrack) (trackToPlay as any).__skipAnnounce = true;

    const result = await this.player.play(member.voice.channel as any, trackToPlay, {
      nodeOptions: {
        metadata: { channel },
        volume: Math.min(100, Math.max(0, musicConfig.defaultVolume)),
        leaveOnEmpty: process.env.MUSIC_LEAVE_ON_EMPTY !== 'false',
        leaveOnEmptyCooldown: parseInt(process.env.MUSIC_LEAVE_ON_EMPTY_DELAY || '300000'),
        leaveOnEnd: process.env.MUSIC_LEAVE_ON_END !== 'false',
        leaveOnEndCooldown: parseInt(process.env.MUSIC_LEAVE_ON_END_DELAY || '30000'),
      },
    });

    if (!result?.track) throw new Error('MUSIC_NO_RESULTS');

    const queue = this.queueOf(guildId);
    const queueSize = (queue?.tracks.size ?? 0) + (queue?.currentTrack ? 1 : 0);
    const started = result.queue.node.isPlaying();

    return { track: this.toTrackView(result.track), started, queueSize };
  }

  /** Resolve a song name or URL to a streamable URL without joining a voice channel. */
  public async searchTrackUrl(query: string): Promise<string> {
    if (!this.player) throw new Error('MUSIC_NODE_UNAVAILABLE');
    const isUrl = query.startsWith('http://') || query.startsWith('https://');
    const resolvedQuery = isUrl ? query : `scsearch:${query}`;
    const result = await this.player.search(resolvedQuery, {
      searchEngine: QueryType.SOUNDCLOUD_SEARCH,
    });
    const track = result.tracks[0];
    if (!track) throw new Error('No results found for query.');
    return track.url;
  }

  public async skip(member: GuildMember, channel: TextChannel): Promise<boolean> {
    const queue = this.queueOf(member.guild.id);
    if (!queue?.currentTrack) {
      // The command replies with the translated message
      return false;
    }
    queue.node.skip();
    return true;
  }

  public async stop(member: GuildMember, channel: TextChannel): Promise<boolean> {
    const queue = this.queueOf(member.guild.id);
    if (!queue) {
      // The command replies with the translated message
      return false;
    }
    queue.delete();
    return true;
  }

  public async disconnect(guildId: string): Promise<boolean> {
    const queue = this.queueOf(guildId);
    if (!queue) return false;
    queue.delete();
    return true;
  }

  /** Shuffles the pending queue. Returns false if there are no tracks queued. */
  public shuffle(guildId: string): boolean {
    const queue = this.queueOf(guildId);
    if (!queue || queue.tracks.size < 2) return false;
    queue.tracks.shuffle();
    return true;
  }

  public async togglePause(guildId: string): Promise<boolean> {
    const queue = this.queueOf(guildId);
    if (!queue) return false;
    if (queue.node.isPaused()) {
      queue.node.resume();
    } else {
      queue.node.pause();
    }
    return !queue.node.isPaused();
  }

  public async setVolume(guildId: string, volume: number): Promise<boolean> {
    const queue = this.queueOf(guildId);
    if (!queue) return false;
    queue.node.setVolume(volume);
    return true;
  }

  // ── Dashboard status ──────────────────────────────────────────────────────

  /**
   * Live player data for a server. Without Lavalink, audio is processed by
   * the bot itself (discord-player): there is 1 audio node if the system is ready.
   */
  public getLiveStats(guildId: string): { activePlayers: number; activeSeconds: number; nodes: number } {
    const queue = this.queueOf(guildId);
    const active = !!queue?.currentTrack;
    const start = this.sessionStart.get(guildId);

    return {
      activePlayers: active ? 1 : 0,
      activeSeconds: active && start ? Math.floor((Date.now() - start) / 1000) : 0,
      nodes: this.isReady() ? 1 : 0,
    };
  }

  /**
   * Server queue without discord-player hooks: `useQueue()` throws
   * IllegalHookInvocationError outside `player.context.provide()` or if the
   * player is not initialized (e.g. from the dashboard API).
   */
  private queueOf(guildId: string): GuildQueue | null {
    if (!this.player || !guildId) return null;
    return (this.player.nodes.get(guildId) as GuildQueue | undefined) ?? null;
  }

  // ── Queue views ────────────────────────────────────────────────────────────

  public getQueue(guildId: string): MusicQueueView | null {
    const queue = this.queueOf(guildId);
    if (!queue) return null;
    return {
      tracks: queue.tracks.toArray().map(t => this.toTrackView(t)),
      currentTrack: queue.currentTrack ? this.toTrackView(queue.currentTrack) : null,
      voiceChannel: queue.channel ? { id: queue.channel.id } : null,
      paused: queue.node.isPaused(),
      volume: queue.node.volume,
      loop: queue.repeatMode === 1 ? 'track' : queue.repeatMode === 2 ? 'queue' : 'none',
    };
  }

  public getQueueDisplay(guildId: string, page = 1): MusicQueueDisplay | null {
    const queue = this.queueOf(guildId);
    if (!queue) return null;

    const allTracks = queue.tracks.toArray();
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(allTracks.length / pageSize));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const start = (safePage - 1) * pageSize;

    return {
      tracks: allTracks.slice(start, start + pageSize).map((t, i) => ({
        position: start + i + 1,
        ...this.toTrackView(t),
      })),
      currentTrack: queue.currentTrack ? this.toTrackView(queue.currentTrack) : null,
      currentPage: safePage,
      totalPages,
      totalTracks: allTracks.length,
      page: safePage,
      volume: queue.node.volume,
      paused: queue.node.isPaused(),
      loop: queue.repeatMode === 1 ? 'track' : queue.repeatMode === 2 ? 'queue' : 'none',
    };
  }

  public getCurrentPosition(guildId: string): number {
    const queue = this.queueOf(guildId);
    return queue?.node.getTimestamp()?.current.value ?? 0;
  }

  // ── Misc ───────────────────────────────────────────────────────────────────

  private configCache = new Map<string, { config: MusicConfig; expires: number }>();

  /** Music settings from the dashboard (music_configs table) or defaults. */
  public async getMusicConfig(guildId: string): Promise<MusicConfig> {
    const cached = this.configCache.get(guildId);
    if (cached && cached.expires > Date.now()) return cached.config;

    const row = await this.client.db.musicConfig.findUnique({ where: { guildId } }).catch(() => null);
    const config: MusicConfig = {
      enabled: row?.enabled ?? true,
      djRoleId: row?.djRoleId ?? null,
      djOnly: row?.djOnly ?? false,
      maxQueueSize: row?.maxQueueSize ?? 100,
      maxSongDuration: row?.maxSongDuration ?? 3600,
      defaultVolume: row?.defaultVolume ?? 50,
      announceNowPlaying: row?.announceNowPlaying ?? true,
      restrictedChannels: row?.restrictedChannels ?? [],
      voteSkipEnabled: row?.voteSkipEnabled ?? true,
      voteSkipThreshold: row?.voteSkipThreshold ?? 50,
    };
    this.configCache.set(guildId, { config, expires: Date.now() + 60_000 });
    return config;
  }

  public async updateGuildConfig(guildId: string, config: Partial<MusicConfig>): Promise<MusicConfig> {
    await this.client.db.musicConfig.upsert({
      where: { guildId },
      update: config,
      create: { guildId, ...config },
    });
    this.configCache.delete(guildId);
    return this.getMusicConfig(guildId);
  }

  public async hasDJPermissions(member: GuildMember): Promise<boolean> {
    if (member.permissions.has('ManageChannels') || member.permissions.has('Administrator')) return true;
    const config = await this.getMusicConfig(member.guild.id);
    if (config.djRoleId && member.roles.cache.has(config.djRoleId)) return true;
    return this.hasMusicProDJRole(member);
  }

  /**
   * Music Pro DJ roles: they count in addition to the Music module's DJ role when the
   * server has Music Pro active (license + master switch).
   */
  private async hasMusicProDJRole(member: GuildMember): Promise<boolean> {
    const proSvc = (this.client as any)?._musicProService;
    if (!proSvc) return false;
    try {
      if (!(await proSvc.isProEnabled(member.guild.id))) return false;
      const cfg = await proSvc.getOrCreateConfig(member.guild.id);
      return Array.isArray(cfg.djRoles) && cfg.djRoles.some((roleId: string) => member.roles.cache.has(roleId));
    } catch {
      return false;
    }
  }

  // Votes to skip the current track: guildId → { track, voters }
  private skipVotes = new Map<string, { trackId: string; voters: Set<string> }>();

  /**
   * Vote to skip. Skips directly if voting is disabled, if
   * the voter is a DJ, requested the track or is alone with the bot; otherwise counts the
   * vote and skips once the configured percentage of listeners is reached.
   */
  public async registerSkipVote(member: GuildMember): Promise<{ status: 'skip' | 'voted' | 'already_voted'; votes: number; required: number }> {
    const queue = this.queueOf(member.guild.id);
    const track = queue?.currentTrack;
    const config = await this.getMusicConfig(member.guild.id);
    const listeners = queue?.channel?.members.filter((m) => !m.user.bot).size ?? 1;

    if (!track || !config.voteSkipEnabled || listeners <= 1
        || track.requestedBy?.id === member.id || await this.hasDJPermissions(member)) {
      this.skipVotes.delete(member.guild.id);
      return { status: 'skip', votes: 0, required: 0 };
    }

    const threshold = Math.min(100, Math.max(1, config.voteSkipThreshold));
    const required = Math.max(1, Math.ceil(listeners * threshold / 100));
    let entry = this.skipVotes.get(member.guild.id);
    if (!entry || entry.trackId !== track.id) {
      entry = { trackId: track.id, voters: new Set() };
      this.skipVotes.set(member.guild.id, entry);
    }
    if (entry.voters.has(member.id)) {
      return { status: 'already_voted', votes: entry.voters.size, required };
    }
    entry.voters.add(member.id);

    if (entry.voters.size >= required) {
      this.skipVotes.delete(member.guild.id);
      return { status: 'skip', votes: entry.voters.size, required };
    }
    return { status: 'voted', votes: entry.voters.size, required };
  }

  /**
   * Checks whether a member can use music commands in that channel.
   * Returns the rejection reason (i18n key music.access.*) or null.
   */
  public async checkAccess(member: GuildMember, textChannelId: string): Promise<'disabled' | 'channel' | 'dj_only' | null> {
    const config = await this.getMusicConfig(member.guild.id);
    if (!config.enabled) return 'disabled';
    if (config.restrictedChannels.length > 0 && !config.restrictedChannels.includes(textChannelId)) return 'channel';
    if (config.djOnly && !(await this.hasDJPermissions(member))) return 'dj_only';
    return null;
  }


  public getStats(): MusicStats {
    if (!this.player) return { totalTracks: 0, totalPlaytime: 0, activeUsers: 0, topTracks: [], topUsers: [] };
    let totalTracks = 0;
    for (const queue of this.player.queues.cache.values()) {
      totalTracks += (queue as GuildQueue).tracks.size + ((queue as GuildQueue).currentTrack ? 1 : 0);
    }
    return {
      totalTracks,
      totalPlaytime: 0,
      activeUsers: this.player.queues.cache.size,
      topTracks: [],
      topUsers: [],
    };
  }

  // ── YouTube quota ──────────────────────────────────────────────────────────

  /** Quota limits per plan (monthly YouTube plays) */
  private static readonly YOUTUBE_QUOTA: Record<string, number> = {
    demo:  50,
    basic: 150,
    pro:   200,
  };

  private async checkYoutubeQuota(guildId: string): Promise<{
    isPremium: boolean;
    canUseYoutube: boolean;
    quotaUsed: number;
    quotaLimit: number;
  }> {
    try {
      const premium = await this.client.db.guildPremium.findUnique({
        where: { guildId },
        select: {
          status: true,
          planId: true,
          expiresAt: true,
          usageYoutubeMonthly: true,
          usageYoutubeResetAt: true,
        },
      });

      if (!premium || premium.status !== 'ACTIVE' || premium.expiresAt < new Date()) {
        return { isPremium: false, canUseYoutube: false, quotaUsed: 0, quotaLimit: 0 };
      }

      const limit = MusicService.YOUTUBE_QUOTA[premium.planId] ?? 150;

      // Reset monthly counter if it's a new month
      const resetAt = premium.usageYoutubeResetAt;
      const now = new Date();
      let used = premium.usageYoutubeMonthly;

      if (resetAt.getMonth() !== now.getMonth() || resetAt.getFullYear() !== now.getFullYear()) {
        await this.client.db.guildPremium.update({
          where: { guildId },
          data: { usageYoutubeMonthly: 0, usageYoutubeResetAt: now },
        });
        used = 0;
      }

      return { isPremium: true, canUseYoutube: used < limit, quotaUsed: used, quotaLimit: limit };
    } catch {
      return { isPremium: false, canUseYoutube: false, quotaUsed: 0, quotaLimit: 0 };
    }
  }

  private async incrementYoutubeQuota(guildId: string): Promise<void> {
    await this.client.db.guildPremium.update({
      where: { guildId },
      data: { usageYoutubeMonthly: { increment: 1 } },
    });
  }

  /** Public: get current YouTube usage for a guild (for dashboard/commands) */
  public async getYoutubeUsage(guildId: string): Promise<{ used: number; limit: number; isPremium: boolean } | null> {
    const { isPremium, quotaUsed, quotaLimit } = await this.checkYoutubeQuota(guildId);
    if (!isPremium) return null;
    return { used: quotaUsed, limit: quotaLimit, isPremium };
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  private setupEvents(): void {
    if (!this.player) return;

    this.player.events.on('queueCreate', (queue) => {
      this.sessionStart.set(queue.guild.id, Date.now());
    });
    this.player.events.on('queueDelete', (queue) => {
      this.sessionStart.delete(queue.guild.id);
    });

    this.player.events.on('playerStart', async (queue, track) => {
      this.logger.info(`🎵 Now playing: ${track.title} in ${queue.guild.id}`);
      const meta = (queue as GuildQueue<{ channel: TextChannel }>).metadata;
      if (!meta?.channel) return;
      // The first track is already announced by the /play reply
      if ((track as any).__skipAnnounce) {
        delete (track as any).__skipAnnounce;
        return;
      }
      const guildId = queue.guild.id;
      const config = await this.getMusicConfig(guildId).catch(() => null);
      if (config && !config.announceNowPlaying) return;
      const t = (key: string) => i18n.t(key, guildId);
      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle(`🎵 ${t('music.now_playing')}`)
        .setDescription(`**${track.title}**\n${track.author}`.slice(0, 4096))
        .setThumbnail(track.thumbnail || null)
        .addFields(
          { name: t('music.duration'), value: this.formatDuration(track.durationMS), inline: true },
          { name: t('music.requester'), value: track.requestedBy?.displayName ?? t('music.unknown'), inline: true },
        )
        .setTimestamp();
      meta.channel.send({ embeds: [embed] }).catch(() => {});
    });

    this.player.events.on('playerError', (queue, error) => {
      this.logger.error(`🎵 playerError in ${queue.guild.id}:`, error);
      const meta = (queue as GuildQueue<{ channel: TextChannel }>).metadata;
      // On stream error, skip to next track instead of stopping
      if (queue.tracks.size > 0) {
        this.logger.info(`🎵 Skipping failed track, ${queue.tracks.size} remaining`);
        queue.node.skip();
      } else {
        meta?.channel?.send(`❌ ${i18n.t('music.playback_error', queue.guild.id)}`).catch(() => {});
      }
    });

    this.player.events.on('emptyQueue', (queue) => {
      this.logger.info(`🎵 Queue finished in ${queue.guild.id}`);
      const meta = (queue as GuildQueue<{ channel: TextChannel }>).metadata;
      meta?.channel?.send(`🎵 ${i18n.t('music.queue_finished', queue.guild.id)}`).catch(() => {});
    });

    this.player.events.on('error', (queue, error) => {
      this.logger.error(`🎵 General error in ${queue.guild.id}:`, error);
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private toTrackView(track: Track): MusicTrackView {
    const requestedBy = track.requestedBy;
    return {
      title: track.title,
      artist: track.author,
      duration: track.durationMS,
      requestedBy: {
        id: requestedBy?.id ?? 'unknown',
        displayName: requestedBy?.displayName ?? requestedBy?.username ?? 'Unknown',
        mention: requestedBy ? `<@${requestedBy.id}>` : 'Unknown',
      },
      thumbnail: track.thumbnail ?? null,
      source: track.source ?? 'unknown',
      uri: track.url,
    };
  }

  private formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }

  private loadCookies(): string | undefined {
    try {
      const fs = require('fs');
      const path = require('path');
      const cookiePath = path.join(process.cwd(), 'yt-cookies.txt');
      if (!fs.existsSync(cookiePath)) return undefined;
      // Convert Netscape format to header string
      const lines = fs.readFileSync(cookiePath, 'utf8').split('\n');
      return lines
        .filter((l: string) => l && !l.startsWith('#'))
        .map((l: string) => { const p = l.split('\t'); return p.length >= 7 ? `${p[5]}=${p[6]}` : null; })
        .filter(Boolean)
        .join('; ');
    } catch {
      return undefined;
    }
  }
}
