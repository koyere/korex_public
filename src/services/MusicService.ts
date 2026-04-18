/**
 * MusicService — discord-player + discord-player-youtubei
 *
 * Public interface is intentionally identical to the previous Lavalink-based
 * implementation so that all commands, components and the health monitor
 * continue to work without changes.
 *
 * LAVALINK FALLBACK NOTE:
 * Lavalink is kept stopped in PM2 (pm2 stop lavalink) and its application.yml
 * is preserved at /home/ubuntu/application.yml.  If youtube-source ever gains
 * reliable cookie/OAuth support, the Lavalink path can be restored by:
 *   1. pm2 start lavalink
 *   2. Reverting this file to the lavalink-client implementation
 *   3. Re-adding lavalink-client to package.json
 */

import {
  GuildMember,
  TextChannel,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { Player, GuildQueue, Track, useQueue, QueryType } from 'discord-player';
import { SoundCloudExtractor } from '@discord-player/extractor';
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
    // SoundCloud only — YoutubeiExtractor is NOT registered because this VPS IP
    // is blocked by YouTube for streaming (400 on player API + decipher failure).
    // Registering it causes discord-player to call it as a fallback stream provider
    // even for SoundCloud tracks, breaking playback.
    // TODO: re-enable YoutubeiExtractor when proxy/IP rotation is available for premium.
    await this.player.extractors.register(SoundCloudExtractor, {});
    this.logger.info('🎵 SoundCloudExtractor registered');
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
  ): Promise<MusicPlayResult> {
    if (!this.player) throw new Error('MUSIC_NODE_UNAVAILABLE');
    if (!member.voice.channel) throw new Error('Debes estar en un canal de voz para usar este comando.');

    const existingQueue = useQueue(member.guild.id);
    if (existingQueue && existingQueue.channel?.id !== member.voice.channel.id) {
      throw new Error('MUSIC_DIFFERENT_VOICE_CHANNEL');
    }

    const guildId = member.guild.id;
    const isUrl = query.startsWith('http://') || query.startsWith('https://');
    const isYouTubeUrl = isUrl && /youtube\.com|youtu\.be/.test(query);

    // ── Determine source based on plan ──────────────────────────────────────
    const { canUseYoutube, quotaUsed, quotaLimit, isPremium } =
      await this.checkYoutubeQuota(guildId);

    let resolvedQuery = query;

    if (isYouTubeUrl || (!isUrl && !query.startsWith('sc:'))) {
      // User wants YouTube (explicit URL or plain text search)
      if (!isPremium) {
        // FREE: redirect to SoundCloud
        resolvedQuery = isUrl ? query : `scsearch:${query}`;
        this.logger.info(`[${guildId}] FREE tier — routing to SoundCloud: ${query}`);
      } else if (!canUseYoutube) {
        // PREMIUM but quota exhausted — fallback to SoundCloud
        resolvedQuery = isUrl ? query : `scsearch:${query}`;
        this.logger.warn(`[${guildId}] YouTube quota exhausted (${quotaUsed}/${quotaLimit}) — fallback to SoundCloud`);
        channel.send(`⚠️ Cuota de YouTube agotada este mes (${quotaUsed}/${quotaLimit}). Reproduciendo desde SoundCloud.`).catch(() => {});
      } else {
        // PREMIUM with quota available — use YouTube
        resolvedQuery = isUrl ? query : `ytsearch:${query}`;
        this.logger.info(`[${guildId}] PREMIUM YouTube (${quotaUsed + 1}/${quotaLimit}): ${query}`);
      }
    }

    // Search explicitly with forced source — no implicit fallback to YouTube
    const searchResult = await this.player.search(resolvedQuery, {
      requestedBy: member.user,
      searchEngine: resolvedQuery.startsWith('ytsearch:') ? QueryType.YOUTUBE_SEARCH : QueryType.SOUNDCLOUD_SEARCH,
    });

    // Filter out MONETIZE tracks (require SC OAuth to stream — will fail silently)
    const playableTracks = searchResult.tracks.filter(t => {
      const raw = (t as any).raw;
      return !raw?.policy || raw.policy === 'ALLOW' || raw.policy === 'SNIP';
    });

    const trackToPlay = playableTracks[0] ?? searchResult.tracks[0];
    if (!trackToPlay) throw new Error('No se encontraron resultados para tu búsqueda.');

    const result = await this.player.play(member.voice.channel as any, trackToPlay, {
      nodeOptions: {
        metadata: { channel },
        volume: parseInt(process.env.MUSIC_DEFAULT_VOLUME || '50'),
        leaveOnEmpty: process.env.MUSIC_LEAVE_ON_EMPTY !== 'false',
        leaveOnEmptyCooldown: parseInt(process.env.MUSIC_LEAVE_ON_EMPTY_DELAY || '300000'),
        leaveOnEnd: process.env.MUSIC_LEAVE_ON_END !== 'false',
        leaveOnEndCooldown: parseInt(process.env.MUSIC_LEAVE_ON_END_DELAY || '30000'),
      },
    });

    if (!result?.track) throw new Error('No se encontraron resultados para tu búsqueda.');

    // Increment YouTube quota if we used it
    const usedYoutube = isPremium && canUseYoutube &&
      (isYouTubeUrl || (!isUrl && resolvedQuery.startsWith('ytsearch:')));
    if (usedYoutube) {
      await this.incrementYoutubeQuota(guildId).catch(() => {});
    }

    const queue = useQueue(guildId);
    const queueSize = (queue?.tracks.size ?? 0) + (queue?.currentTrack ? 1 : 0);
    const started = result.queue.node.isPlaying();

    return { track: this.toTrackView(result.track), started, queueSize };
  }

  public async skip(member: GuildMember, channel: TextChannel): Promise<boolean> {
    const queue = useQueue(member.guild.id);
    if (!queue?.currentTrack) {
      await channel.send('❌ No hay música reproduciéndose.');
      return false;
    }
    const skipped = queue.currentTrack;
    queue.node.skip();
    await channel.send(`⏭️ **${skipped.title}** saltada.`);
    return true;
  }

  public async stop(member: GuildMember, channel: TextChannel): Promise<boolean> {
    const queue = useQueue(member.guild.id);
    if (!queue) {
      await channel.send('❌ No hay música reproduciéndose.');
      return false;
    }
    queue.delete();
    await channel.send('⏹️ Música detenida y desconectado del canal de voz.');
    return true;
  }

  public async disconnect(guildId: string): Promise<boolean> {
    const queue = useQueue(guildId);
    if (!queue) return false;
    queue.delete();
    return true;
  }

  public async togglePause(guildId: string): Promise<boolean> {
    const queue = useQueue(guildId);
    if (!queue) return false;
    if (queue.node.isPaused()) {
      queue.node.resume();
    } else {
      queue.node.pause();
    }
    return !queue.node.isPaused();
  }

  public async setVolume(guildId: string, volume: number): Promise<boolean> {
    const queue = useQueue(guildId);
    if (!queue) return false;
    queue.node.setVolume(volume);
    return true;
  }

  // ── Queue views ────────────────────────────────────────────────────────────

  public getQueue(guildId: string): MusicQueueView | null {
    const queue = useQueue(guildId);
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
    const queue = useQueue(guildId);
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
    const queue = useQueue(guildId);
    return queue?.node.getTimestamp()?.current.value ?? 0;
  }

  // ── Misc ───────────────────────────────────────────────────────────────────

  public async getMusicConfig(_guildId: string): Promise<MusicConfig> {
    return {
      enabled: true,
      djRoleId: null,
      djOnly: false,
      maxQueueSize: 100,
      maxSongDuration: 3600,
      defaultVolume: 50,
      announceNowPlaying: true,
      restrictedChannels: [],
    };
  }

  public async updateGuildConfig(_guildId: string, _config: Partial<MusicConfig>): Promise<void> {}

  public async hasDJPermissions(member: GuildMember): Promise<boolean> {
    return member.permissions.has('ManageChannels') || member.permissions.has('Administrator');
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

    this.player.events.on('playerStart', (queue, track) => {
      this.logger.info(`🎵 Reproduciendo: ${track.title} en ${queue.guild.id}`);
      const meta = (queue as GuildQueue<{ channel: TextChannel }>).metadata;
      if (!meta?.channel) return;
      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle('🎵 Reproduciendo ahora')
        .setDescription(`**${track.title}**\nPor: ${track.author}`)
        .setThumbnail(track.thumbnail ?? null)
        .addFields(
          { name: 'Duración', value: this.formatDuration(track.durationMS), inline: true },
          { name: 'Solicitado por', value: track.requestedBy?.displayName ?? 'Desconocido', inline: true },
        )
        .setTimestamp();
      meta.channel.send({ embeds: [embed] }).catch(() => {});
    });

    this.player.events.on('playerError', (queue, error) => {
      this.logger.error(`🎵 playerError en ${queue.guild.id}:`, error);
      const meta = (queue as GuildQueue<{ channel: TextChannel }>).metadata;
      // On stream error, skip to next track instead of stopping
      if (queue.tracks.size > 0) {
        this.logger.info(`🎵 Skipping failed track, ${queue.tracks.size} remaining`);
        queue.node.skip();
      } else {
        meta?.channel?.send(`❌ Error reproduciendo: ${error.message}`).catch(() => {});
      }
    });

    this.player.events.on('emptyQueue', (queue) => {
      this.logger.info(`🎵 Cola terminada en ${queue.guild.id}`);
      const meta = (queue as GuildQueue<{ channel: TextChannel }>).metadata;
      meta?.channel?.send('🎵 Cola de reproducción terminada.').catch(() => {});
    });

    this.player.events.on('error', (queue, error) => {
      this.logger.error(`🎵 Error general en ${queue.guild.id}:`, error);
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
