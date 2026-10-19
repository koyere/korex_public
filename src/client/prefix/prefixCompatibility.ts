/**
 * Compatibilidad de los comandos slash con su uso por prefijo.
 *
 * Por defecto TODOS los comandos funcionan con prefijo a través del adaptador
 * (MessageCommandInteraction). Aquí se listan solo las rutas que no pueden
 * funcionar desde un mensaje de texto, para avisar ANTES de ejecutar nada:
 *
 *  - `modal`:     abren un formulario (modal) directamente desde el comando;
 *                 un mensaje de texto no puede abrir modales.
 *  - `sensitive`: piden datos secretos (claves de API, etc.) que no deben
 *                 escribirse en un canal visible.
 *
 * Formato de las rutas: '*' (todo el comando), 'sub', 'grupo' o 'grupo sub'.
 *
 * Además de esta lista hay una red de seguridad en tiempo de ejecución: si un
 * comando intenta abrir un modal sobre la interacción de mensaje, el adaptador
 * lanza PrefixUnsupportedError y se responde con el mismo aviso (y se devuelve
 * el cooldown). Las opciones con nombre "sensible" (password, token, clave…)
 * se rechazan siempre, aparezcan en el comando que aparezcan.
 */
export type PrefixUnsupportedReason = 'modal' | 'sensitive';

export const PREFIX_UNSUPPORTED: Record<string, Partial<Record<PrefixUnsupportedReason, string[]>>> = {
  // Núcleo
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
  // `paste edit` captura el fallo del modal y respondería un error genérico
  paste:        { modal: ['create', 'edit'] },
  aiconfig:     { sensitive: ['ai-key'] },
};

/** Opciones cuyo valor no debe escribirse nunca en un canal */
export const SENSITIVE_OPTION = /^(password|passwd|contrase(ñ|n)a|clave|secret|secreto|token|api[_-]?key|apikey)$/i;

/**
 * Motivo por el que una ruta no es compatible con prefijo (o null si lo es).
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

/** El comando entero no se puede usar con prefijo */
export function isFullyUnsupported(commandName: string): boolean {
  const entry = PREFIX_UNSUPPORTED[commandName];
  return !!entry && Object.values(entry).some(paths => paths?.includes('*'));
}

/** El comando tiene alguna ruta no compatible (pero no todas) */
export function isPartiallyUnsupported(commandName: string): boolean {
  return !!PREFIX_UNSUPPORTED[commandName] && !isFullyUnsupported(commandName);
}
