import type { ModalBuilder, ModalSubmitInteraction } from 'discord.js';
import type { KorexClient } from '../client/KorexClient';

interface ModalCapable {
  id: string;
  user: { id: string };
  showModal(modal: ModalBuilder): Promise<unknown>;
  awaitModalSubmit(options: { time: number; filter: (i: ModalSubmitInteraction) => boolean }): Promise<ModalSubmitInteraction>;
}

/**
 * Shows a modal and waits for ITS submission (audit 2026-11-21, G·BOT-04 and H·BOT2-02):
 *  - unique customId per invocation (`<base>:<interaction.id>`);
 *  - only accepts that modal's submission by the same user (awaitModalSubmit
 *    without a filter captures the next modal from ANY user and server);
 *  - while it waits, the global dispatcher does not answer that modal (it used
 *    to reply "form expired" and race the collector).
 * Throws the collector's error when the time runs out.
 */
export async function awaitOwnModal(
  client: KorexClient,
  interaction: ModalCapable,
  modal: ModalBuilder,
  baseId: string,
  timeMs: number,
): Promise<ModalSubmitInteraction> {
  const customId = `${baseId}:${interaction.id}`;
  modal.setCustomId(customId);
  client.components.expectModal(customId);
  try {
    await interaction.showModal(modal);
    return await interaction.awaitModalSubmit({
      time: timeMs,
      filter: (i) => i.customId === customId && i.user.id === interaction.user.id,
    });
  } finally {
    client.components.releaseModal(customId);
  }
}
