/**
 * SupportTicketService
 *
 * Gestión de tickets de soporte interno: guild owners → equipo Korex.
 * Distinto del addon de tickets de Discord (que es guild members → staff del guild).
 */

import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { createLogger } from '../../utils/Logger';
import type { TeamNotificationService } from './TeamNotificationService';
import type { EmailService } from './EmailService';

const logger = createLogger('support-tickets');

export interface CreateTicketInput {
  guildId:     string;
  userId:      string;      // Discord ID del solicitante
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
  senderId:   string;      // admin_users.id o Discord user ID
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

  // ─── Crear ticket (guild side) ──────────────────────────────────────────────

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

    // Guardar mensaje inicial
    const message = await this.db.supportTicketMessage.create({
      data: {
        ticketId:  ticket.id,
        senderId:  input.userId,
        isStaff:   false,
        content:   input.description,
      },
    });

    // Guardar adjuntos si los hay
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

    // Notificar al equipo
    try {
      const guild = await this.db.guild.findUnique({ where: { id: input.guildId } });
      await this.teamNotification.notifyNewSupportTicket({
        ticketId:   ticket.id,
        guildId:    input.guildId,
        guildName:  guild?.id || input.guildId, // El nombre real se obtiene via Discord API
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

  // ─── Listar tickets (guild side) ───────────────────────────────────────────

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

  // ─── Detalle del ticket ─────────────────────────────────────────────────────

  async getTicketDetail(ticketId: string, markReadForGuild = false) {
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

    if (markReadForGuild && ticket.unreadGuild > 0) {
      await this.db.supportTicket.update({
        where: { id: ticketId },
        data:  { unreadGuild: 0 },
      });
    }

    return ticket;
  }

  // ─── Responder ticket ───────────────────────────────────────────────────────

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

    // Guardar adjuntos
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

    // Actualizar estado y contadores
    const updates: any = {
      updatedAt: new Date(),
    };

    if (input.isStaff) {
      // Staff responde → cambiar a waiting_customer, incrementar unreadGuild
      updates.status      = 'waiting_customer';
      updates.unreadGuild = { increment: 1 };
      if (!ticket.firstResponseAt) {
        const firstResponseTime = Math.floor((Date.now() - ticket.createdAt.getTime()) / 1000);
        updates.firstResponseAt   = new Date();
        updates.firstResponseTime = firstResponseTime;
      }
    } else {
      // Guild responde → cambiar a in_progress, incrementar unreadAdmin
      updates.status      = 'in_progress';
      updates.unreadAdmin = { increment: 1 };
    }

    await this.db.supportTicket.update({
      where: { id: input.ticketId },
      data:  updates,
    });

    // Notificar al guild si es respuesta del staff
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

      // Enviar email si tiene email guardado y preferencia activa
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

  // ─── Cerrar ticket ──────────────────────────────────────────────────────────

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

  // ─── Unread count (para badge del sidebar) ─────────────────────────────────

  async getUnreadCountForGuild(guildId: string): Promise<number> {
    const result = await this.db.supportTicket.aggregate({
      where: { guildId, status: { not: 'closed' } },
      _sum:  { unreadGuild: true },
    });
    return result._sum.unreadGuild ?? 0;
  }

  // ─── Admin: lista con filtros ───────────────────────────────────────────────

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

  // ─── Admin: asignar ticket ──────────────────────────────────────────────────

  async assignTicket(ticketId: string, operatorId: string | null): Promise<void> {
    await this.db.supportTicket.update({
      where: { id: ticketId },
      data:  { assignedTo: operatorId, unreadAdmin: 0 },
    });
  }

  // ─── Admin: cambiar prioridad/estado ───────────────────────────────────────

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

  // ─── Templates de respuesta ─────────────────────────────────────────────────

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
