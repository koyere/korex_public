/**
 * SupportTicketService
 *
 * Internal support ticket management: guild owners → Korex team.
 * Different from the Discord tickets addon (which is guild members → guild staff).
 */

import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { createLogger } from '../../utils/Logger';
import type { TeamNotificationService } from './TeamNotificationService';
import type { EmailService } from './EmailService';

const logger = createLogger('support-tickets');

export interface CreateTicketInput {
  guildId:     string;
  userId:      string;      // Discord ID of the requester
  subject:     string;
  category:    string;
  description: string;
  priority?:   string;
  addonName?:  string;
  attachments?: Array<{
    filename:   string;
    mimetype:   string;
    sizeBytes:  number;
    storageKey: string;
    storageType?: string;
  }>;
}

export interface ReplyTicketInput {
  ticketId:   string;
  senderId:   string;      // admin_users.id or Discord user ID
  content:    string;
  isStaff:    boolean;
  sendDm?:    boolean;
  sendEmail?: boolean;
  attachments?: Array<{
    filename:   string;
    mimetype:   string;
    sizeBytes:  number;
    storageKey: string;
    storageType?: string;
  }>;
}

export class SupportTicketService {
  private db: PrismaClient;
  private redis: Redis;
  private teamNotification: TeamNotificationService;
  private emailService: EmailService;

  constructor(db: PrismaClient, redis: Redis, teamNotification: TeamNotificationService, emailService: EmailService) {
    this.db               = db;
    this.redis            = redis;
    this.teamNotification = teamNotification;
    this.emailService     = emailService;
  }

  // ─── Create ticket (guild side) ──────────────────────────────────────────────

  async createTicket(input: CreateTicketInput) {
    const ticket = await this.db.supportTicket.create({
      data: {
        guildId:     input.guildId,
        userId:      input.userId,
        subject:     input.subject.slice(0, 100),
        category:    input.category,
        description: input.description.slice(0, 2000),
        priority:    input.priority || 'normal',
        addonName:   input.addonName,
        status:      'open',
      },
    });

    // Save initial message
    const message = await this.db.supportTicketMessage.create({
      data: {
        ticketId:  ticket.id,
        senderId:  input.userId,
        isStaff:   false,
        content:   input.description,
      },
    });

    // Save attachments if any
    if (input.attachments?.length) {
      await this.db.supportTicketAttachment.createMany({
        data: input.attachments.map(a => ({
          ticketId:    ticket.id,
          messageId:   message.id,
          filename:    a.filename,
          mimetype:    a.mimetype,
          sizeBytes:   a.sizeBytes,
          storageKey:  a.storageKey,
          storageType: a.storageType || 'disk',
        })),
      });
    }

    // Notify the team
    try {
      const guild = await this.db.guild.findUnique({ where: { id: input.guildId } });
      await this.teamNotification.notifyNewSupportTicket({
        ticketId:   ticket.id,
        guildId:    input.guildId,
        guildName:  guild?.id || input.guildId, // The real name is obtained via the Discord API
        ownerName:  input.userId,
        subject:    input.subject,
        category:   input.category,
        priority:   input.priority || 'normal',
        addonName:  input.addonName,
      });
    } catch (err) {
      logger.error('Error notifying team about new support ticket', { error: err });
    }

    logger.info(`Support ticket created: ${ticket.id} by guild ${input.guildId}`);
    return ticket;
  }

  // ─── List tickets (guild side) ────────────────────────────────────────────

  async getTicketsForGuild(guildId: string) {
    const tickets = await this.db.supportTicket.findMany({
      where: { guildId },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, isStaff: true, createdAt: true },
        },
      },
    });

    const unreadTotal = tickets.reduce((sum, t) => sum + t.unreadGuild, 0);

    const grouped = {
      open:            tickets.filter(t => t.status === 'open'),
      inProgress:      tickets.filter(t => t.status === 'in_progress'),
      waitingCustomer: tickets.filter(t => t.status === 'waiting_customer'),
      closed:          tickets.filter(t => t.status === 'closed'),
      unreadTotal,
    };

    return grouped;
  }

  // ─── Ticket details ─────────────────────────────────────────────────────────

  /**
   * Ticket details. With `guildId` the ticket must belong to that server:
   * otherwise, returns null WITHOUT marking it as read (previously another guild's ticket was marked).
   */
  async getTicketDetail(ticketId: string, markReadForGuild = false, guildId?: string) {
    const ticket = await this.db.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            attachments: true,
          },
        },
        attachments: {
          where: { messageId: null },
        },
      },
    });

    if (!ticket) return null;
    if (guildId !== undefined && ticket.guildId !== guildId) return null;

    if (markReadForGuild && ticket.unreadGuild > 0) {
      await this.db.supportTicket.updateMany({
        where: { id: ticketId, guildId: ticket.guildId },
        data:  { unreadGuild: 0 },
      });
    }

    return ticket;
  }

  // ─── Reply to ticket ───────────────────────────────────────────────────────

  async replyToTicket(input: ReplyTicketInput) {
    const ticket = await this.db.supportTicket.findUniqueOrThrow({
      where: { id: input.ticketId },
    });

    const message = await this.db.supportTicketMessage.create({
      data: {
        ticketId: input.ticketId,
        senderId: input.senderId,
        isStaff:  input.isStaff,
        content:  input.content.slice(0, 4000),
        sentVia:  [
          ...(input.sendDm    ? ['dm']    : []),
          ...(input.sendEmail ? ['email'] : []),
        ],
      },
    });

    // Save attachments
    if (input.attachments?.length) {
      await this.db.supportTicketAttachment.createMany({
        data: input.attachments.map(a => ({
          ticketId:    input.ticketId,
          messageId:   message.id,
          filename:    a.filename,
          mimetype:    a.mimetype,
          sizeBytes:   a.sizeBytes,
          storageKey:  a.storageKey,
          storageType: a.storageType || 'disk',
        })),
      });
    }

    // Update status and counters
    const updates: any = {
      updatedAt: new Date(),
    };

    if (input.isStaff) {
      // Staff replies → switch to waiting_customer, increment unreadGuild
      updates.status      = 'waiting_customer';
      updates.unreadGuild = { increment: 1 };
      if (!ticket.firstResponseAt) {
        const firstResponseTime = Math.floor((Date.now() - ticket.createdAt.getTime()) / 1000);
        updates.firstResponseAt   = new Date();
        updates.firstResponseTime = firstResponseTime;
      }
    } else {
      // Guild replies → switch to in_progress, increment unreadAdmin
      updates.status      = 'in_progress';
      updates.unreadAdmin = { increment: 1 };
    }

    await this.db.supportTicket.update({
      where: { id: input.ticketId },
      data:  updates,
    });

    // Notify the guild if it is a staff reply
    if (input.isStaff) {
      await this.notifyGuildOfReply(ticket, input.content, message.id);
    }

    return message;
  }

  private async notifyGuildOfReply(
    ticket: { id: string; guildId: string; subject: string; userId: string },
    content: string,
    _messageId: string
  ) {
    try {
      const prefs = await this.db.guildNotificationPref.findUnique({
        where: { guildId: ticket.guildId },
      });

      const contact = await this.db.guildContact.findUnique({
        where: { guildId: ticket.guildId },
      });

      const preview = content.slice(0, 200) + (content.length > 200 ? '…' : '');

      // Send an email if an email is stored and the preference is enabled
      if ((prefs?.supportEmail ?? true) && contact?.email) {
        await this.emailService.send(
          contact.email,
          'support_reply',
          {
            ticketId:  ticket.id.slice(0, 8),
            subject:   ticket.subject,
            preview,
            guildId:   ticket.guildId,
          },
          { guildId: ticket.guildId }
        );
      }

    } catch (err) {
      logger.error('Error notifying guild of support reply', { error: err, ticketId: ticket.id });
    }
  }

  // ─── Close ticket ───────────────────────────────────────────────────────────

  async closeTicket(ticketId: string, closedBy: string): Promise<void> {
    const ticket = await this.db.supportTicket.findUniqueOrThrow({
      where: { id: ticketId },
    });

    const resolutionTime = ticket.firstResponseAt
      ? Math.floor((Date.now() - ticket.createdAt.getTime()) / 1000)
      : null;

    await this.db.supportTicket.update({
      where: { id: ticketId },
      data: {
        status:         'closed',
        closedAt:       new Date(),
        resolutionTime: resolutionTime ?? undefined,
      },
    });

    logger.info(`Support ticket closed: ${ticketId} by ${closedBy}`);
  }

  // ─── Unread count (for the sidebar badge) ─────────────────────────────────

  async getUnreadCountForGuild(guildId: string): Promise<number> {
    const result = await this.db.supportTicket.aggregate({
      where: { guildId, status: { not: 'closed' } },
      _sum:  { unreadGuild: true },
    });
    return result._sum.unreadGuild ?? 0;
  }

  // ─── Admin: filtered list ───────────────────────────────────────────────────

  async listTicketsAdmin(filters: {
    status?:    string;
    priority?:  string;
    assignedTo?: string;
    addonName?: string;
    search?:    string;
    page?:      number;
    limit?:     number;
  }) {
    const page  = Math.max(1, filters.page  || 1);
    const limit = Math.min(50, filters.limit || 15);
    const skip  = (page - 1) * limit;

    const where: any = {};
    if (filters.status)     where.status     = filters.status;
    if (filters.priority)   where.priority   = filters.priority;
    if (filters.assignedTo) where.assignedTo = filters.assignedTo;
    if (filters.addonName)  where.addonName  = filters.addonName;
    if (filters.search) {
      where.OR = [
        { subject:     { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [tickets, total] = await Promise.all([
      this.db.supportTicket.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          assignedOperator: {
            select: { id: true, name: true, email: true },
          },
        },
      }),
      this.db.supportTicket.count({ where }),
    ]);

    return { tickets, total, page, totalPages: Math.ceil(total / limit) };
  }

  // ─── Admin: assign ticket ───────────────────────────────────────────────────

  async assignTicket(ticketId: string, operatorId: string | null): Promise<void> {
    await this.db.supportTicket.update({
      where: { id: ticketId },
      data:  { assignedTo: operatorId, unreadAdmin: 0 },
    });
  }

  // ─── Admin: change priority/status ────────────────────────────────────────

  async updateTicket(ticketId: string, data: { status?: string; priority?: string; assignedTo?: string }): Promise<void> {
    await this.db.supportTicket.update({
      where: { id: ticketId },
      data: {
        ...(data.status     && { status:     data.status     }),
        ...(data.priority   && { priority:   data.priority   }),
        ...(data.assignedTo !== undefined && { assignedTo: data.assignedTo }),
        unreadAdmin: 0,
      },
    });
  }

  // ─── Reply templates ────────────────────────────────────────────────────────

  async getReplyTemplates() {
    return this.db.supportReplyTemplate.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }

  async createReplyTemplate(name: string, content: string, createdBy: string) {
    return this.db.supportReplyTemplate.create({
      data: { name, content, createdBy },
    });
  }

  async updateReplyTemplate(id: string, data: { name?: string; content?: string }) {
    return this.db.supportReplyTemplate.update({ where: { id }, data });
  }

  async deleteReplyTemplate(id: string) {
    return this.db.supportReplyTemplate.delete({ where: { id } });
  }
}
