/**
 * Compatibility of slash commands with prefix usage.
 *
 * By default ALL commands work with a prefix through the adapter
 * (MessageCommandInteraction). Only the routes that cannot work from a text
 * message are listed here, to warn BEFORE running anything:
 *
 *  - `modal`:     open a form (modal) directly from the command;
 *                 a text message cannot open modals.
 *  - `sensitive`: ask for secret data (API keys, etc.) that must not
 *                 be typed in a visible channel.
 *
 * Route format: '*' (whole command), 'sub', 'group' or 'group sub'.
 *
 * Besides this list there is a runtime safety net: if a
 * command tries to open a modal on the message interaction, the adapter
 * throws PrefixUnsupportedError and the same notice is sent (and the cooldown
 * is refunded). Options with a "sensitive" name (password, token, key…)
 * are always rejected, in whatever command they appear.
 */
export type PrefixUnsupportedReason = 'modal' | 'sensitive';

export const PREFIX_UNSUPPORTED: Record<string, Partial<Record<PrefixUnsupportedReason, string[]>>> = {
  // Core
  massban:      { modal: ['*'] },
  autoresponse: { modal: ['create', 'edit'] },
  autoroles:    { modal: ['button'] },
  poll:         { modal: ['create'] },

  // Addons
  ticketpanel:  { modal: ['create'] },
  ticketconfig: { modal: ['setup', 'category add', 'category edit', 'questions add', 'tags add', 'templates add', 'rules add'] },
  form:         { modal: ['create', 'edit', 'field add'] },
  formpanel:    { modal: ['create'] },
  staffconfig:  { modal: ['setup'] },
  // `paste edit` catches the modal failure and would reply with a generic error
  paste:        { modal: ['create', 'edit'] },
  aiconfig:     { sensitive: ['ai-key'] },
};

/** Options whose value must never be typed in a channel */
export const SENSITIVE_OPTION = /^(password|passwd|contrase(ñ|n)a|clave|secret|secreto|token|api[_-]?key|apikey)$/i;

/**
 * Reason why a route is not prefix-compatible (or null if it is).
 */
export function getPrefixUnsupportedReason(
  commandName: string,
  group: string | null,
  subcommand: string | null
): PrefixUnsupportedReason | null {
  const entry = PREFIX_UNSUPPORTED[commandName];
  if (!entry) return null;
  const candidates = new Set<string>(['*']);
  if (group) candidates.add(group);
  if (group && subcommand) candidates.add(`${group} ${subcommand}`);
  if (!group && subcommand) candidates.add(subcommand);
  for (const reason of Object.keys(entry) as PrefixUnsupportedReason[]) {
    if (entry[reason]!.some(path => candidates.has(path))) return reason;
  }
  return null;
}

/** The whole command cannot be used with a prefix */
export function isFullyUnsupported(commandName: string): boolean {
  const entry = PREFIX_UNSUPPORTED[commandName];
  return !!entry && Object.values(entry).some(paths => paths?.includes('*'));
}

/** The command has some incompatible routes (but not all) */
export function isPartiallyUnsupported(commandName: string): boolean {
  return !!PREFIX_UNSUPPORTED[commandName] && !isFullyUnsupported(commandName);
}
