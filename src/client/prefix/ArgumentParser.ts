import { ApplicationCommandOptionType } from 'discord.js';

/**
 * Parser de argumentos para los comandos con prefijo.
 *
 * Es puro (sin acceso a Discord ni a la BD): convierte el texto de un mensaje
 * en las opciones que tendría el comando slash equivalente. La resolución de
 * usuarios/roles/canales (que sí necesita el servidor) se hace después en el
 * adaptador, a partir de los IDs que devuelve este módulo.
 *
 * Sintaxis admitida:
 *   - Subcomandos y grupos por nombre:      !ticketconfig category list
 *   - Argumentos posicionales en el orden de las opciones del slash.
 *   - Argumentos con nombre (como en slash): reason:"spam masivo"  delete_days:7
 *   - Comillas ("…", “…”, «…») para valores con espacios; \" escapa una comilla.
 *   - Una opción de texto toma tantas palabras como haga falta para que el
 *     resto de argumentos encaje (!ban @u spam y flood 3 → reason="spam y flood").
 *   - Las opciones de texto opcionales que van justo después de otra de texto
 *     solo se pueden dar por nombre (si no, sería ambiguo dónde corta el texto).
 *   - Usuarios/miembros, roles y canales por mención o por ID.
 *   - Los adjuntos del mensaje rellenan, en orden, las opciones de tipo archivo.
 */

/** Definición de opción tal y como sale de `command.data().toJSON().options` */
export interface PrefixOptionDef {
  name: string;
  type: ApplicationCommandOptionType;
  required?: boolean;
  choices?: { name: string; value: string | number }[];
  min_value?: number;
  max_value?: number;
  min_length?: number;
  max_length?: number;
  autocomplete?: boolean;
  channel_types?: number[];
  options?: PrefixOptionDef[];
}

export interface PrefixToken {
  /** Valor ya sin comillas */
  value: string;
  /** El token contenía comillas */
  quoted: boolean;
  /** Si el token tiene forma `nombre:valor` (con `nombre` fuera de comillas) */
  key?: string;
  /** Valor tras `nombre:` (sin comillas) */
  keyValue?: string;
}

export type MentionableKind = 'user' | 'role' | 'unknown';

export interface ParsedOption {
  name: string;
  type: ApplicationCommandOptionType;
  /** string | number | boolean; para usuario/rol/canal/mencionable, el ID */
  value: string | number | boolean;
  /** Solo para opciones de tipo mencionable */
  mentionKind?: MentionableKind;
  /** Solo para adjuntos: índice dentro de los adjuntos del mensaje */
  attachmentIndex?: number;
  /** Texto original escrito por el usuario (útil para autocompletado) */
  raw: string;
}

export type ParseErrorCode =
  | 'missing_subcommand'
  | 'unknown_subcommand'
  | 'missing_option'
  | 'invalid_value'
  | 'too_many_arguments'
  | 'duplicate_option'
  | 'missing_attachment'
  | 'too_many_tokens';

export interface ParseError {
  code: ParseErrorCode;
  /** Opción afectada (si aplica) */
  option?: PrefixOptionDef;
  /** Valor que no se pudo interpretar (si aplica) */
  value?: string;
  /** Subcomandos disponibles (para missing/unknown_subcommand) */
  available?: string[];
}

export interface ResolvedPath {
  group: string | null;
  subcommand: string | null;
  /** Opciones del nivel final (las del subcomando, o las del comando) */
  options: PrefixOptionDef[];
  /** Tokens que quedan tras consumir grupo/subcomando */
  rest: PrefixToken[];
}

export const MAX_PREFIX_TOKENS = 100;

/** Prefijo válido: 1-5 caracteres, sin espacios, sin acentos graves ni caracteres de control/invisibles */
export const PREFIX_PATTERN = /^[^\s`\p{Cc}\p{Cf}]{1,5}$/u;

const SNOWFLAKE = /^\d{17,20}$/;
const USER_MENTION = /^<@!?(\d{17,20})>$/;
const ROLE_MENTION = /^<@&(\d{17,20})>$/;
const CHANNEL_MENTION = /^<#(\d{17,20})>$/;
const INTEGER = /^[+-]?\d+$/;
const NUMBER = /^[+-]?(\d+([.,]\d+)?|[.,]\d+)$/;

const OPEN_QUOTES: Record<string, string> = { '"': '"', '“': '”', '„': '“', '«': '»' };
const ALL_CLOSE_QUOTES = new Set(['"', '”', '“', '»']);

const TRUE_WORDS = new Set(['true', 'yes', 'y', 'si', 'sí', 's', 'on', '1', 'enable', 'enabled', 'activar', 'activado']);
const FALSE_WORDS = new Set(['false', 'no', 'n', 'off', '0', 'disable', 'disabled', 'desactivar', 'desactivado']);

/**
 * Divide el texto en tokens respetando comillas.
 * Detecta la forma `nombre:valor` cuando `nombre` no está entre comillas.
 */
export function tokenize(input: string): PrefixToken[] {
  const tokens: PrefixToken[] = [];
  let current = '';
  let quoted = false;
  let inToken = false;
  let quoteClose: string | null = null;
  /** Posición (en `current`) del primer ':' fuera de comillas, si lo precede un nombre válido */
  let keySplit = -1;
  let keyValue = '';

  const push = () => {
    if (!inToken) return;
    const token: PrefixToken = { value: current, quoted };
    if (keySplit > 0) {
      token.key = current.slice(0, keySplit);
      token.keyValue = keyValue;
    }
    tokens.push(token);
    current = '';
    quoted = false;
    inToken = false;
    keySplit = -1;
    keyValue = '';
  };

  const append = (ch: string) => {
    current += ch;
    if (keySplit > 0) keyValue += ch;
    inToken = true;
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quoteClose) {
      // Dentro de comillas
      if (ch === '\\' && i + 1 < input.length && (input[i + 1] === quoteClose || ALL_CLOSE_QUOTES.has(input[i + 1]) || input[i + 1] === '\\')) {
        append(input[++i]);
        continue;
      }
      if (ch === quoteClose || (quoteClose === '"' && ch === '”') || (quoteClose === '”' && ch === '"')) {
        quoteClose = null;
        continue;
      }
      append(ch);
      continue;
    }

    if (/\s/.test(ch)) {
      push();
      continue;
    }

    if (ch === '\\' && i + 1 < input.length && (OPEN_QUOTES[input[i + 1]] || ALL_CLOSE_QUOTES.has(input[i + 1]))) {
      append(input[++i]);
      continue;
    }

    if (OPEN_QUOTES[ch]) {
      quoteClose = OPEN_QUOTES[ch];
      quoted = true;
      inToken = true;
      continue;
    }

    if (ch === ':' && keySplit === -1 && !quoted && /^[\p{L}\p{N}_-]{1,32}$/u.test(current)) {
      keySplit = current.length;
      current += ch;
      inToken = true;
      continue;
    }

    append(ch);
  }
  push();

  return tokens;
}

/** Nombres de subcomandos/grupos del nivel indicado */
function subNames(options: PrefixOptionDef[]): string[] {
  return options
    .filter(o => o.type === ApplicationCommandOptionType.Subcommand || o.type === ApplicationCommandOptionType.SubcommandGroup)
    .map(o => o.name);
}

function hasSubcommands(options: PrefixOptionDef[] | undefined): boolean {
  return !!options?.some(o => o.type === ApplicationCommandOptionType.Subcommand || o.type === ApplicationCommandOptionType.SubcommandGroup);
}

/**
 * Consume grupo y subcomando (si el comando los tiene).
 */
export function resolveCommandPath(
  rootOptions: PrefixOptionDef[] | undefined,
  tokens: PrefixToken[]
): { ok: true; path: ResolvedPath } | { ok: false; error: ParseError } {
  const options = rootOptions ?? [];
  if (!hasSubcommands(options)) {
    return { ok: true, path: { group: null, subcommand: null, options, rest: tokens } };
  }

  const first = tokens[0];
  if (!first) return { ok: false, error: { code: 'missing_subcommand', available: subNames(options) } };

  const name = first.value.toLowerCase();
  const match = options.find(o => o.name.toLowerCase() === name
    && (o.type === ApplicationCommandOptionType.Subcommand || o.type === ApplicationCommandOptionType.SubcommandGroup));
  if (!match) return { ok: false, error: { code: 'unknown_subcommand', value: first.value, available: subNames(options) } };

  if (match.type === ApplicationCommandOptionType.Subcommand) {
    return { ok: true, path: { group: null, subcommand: match.name, options: match.options ?? [], rest: tokens.slice(1) } };
  }

  // Grupo: el siguiente token es el subcomando
  const groupOptions = match.options ?? [];
  const second = tokens[1];
  if (!second) return { ok: false, error: { code: 'missing_subcommand', available: subNames(groupOptions).map(s => `${match.name} ${s}`) } };
  const sub = groupOptions.find(o => o.type === ApplicationCommandOptionType.Subcommand && o.name.toLowerCase() === second.value.toLowerCase());
  if (!sub) {
    return { ok: false, error: { code: 'unknown_subcommand', value: `${first.value} ${second.value}`, available: subNames(groupOptions).map(s => `${match.name} ${s}`) } };
  }
  return { ok: true, path: { group: match.name, subcommand: sub.name, options: sub.options ?? [], rest: tokens.slice(2) } };
}

/** Busca una elección por valor o por nombre (sin distinguir mayúsculas) */
function matchChoice(def: PrefixOptionDef, raw: string): string | number | undefined {
  const lower = raw.toLowerCase();
  for (const choice of def.choices ?? []) {
    if (String(choice.value).toLowerCase() === lower) return choice.value;
  }
  for (const choice of def.choices ?? []) {
    if (choice.name.toLowerCase() === lower) return choice.value;
  }
  return undefined;
}

/**
 * Valida y convierte un valor para una opción concreta.
 * Devuelve `null` si el valor no es válido para esa opción.
 */
export function coerceValue(
  def: PrefixOptionDef,
  raw: string
): Pick<ParsedOption, 'value' | 'mentionKind'> | null {
  switch (def.type) {
    case ApplicationCommandOptionType.String: {
      if (def.choices?.length) {
        const choice = matchChoice(def, raw);
        return choice === undefined ? null : { value: String(choice) };
      }
      const len = raw.length;
      if (len < (def.min_length ?? (def.required ? 1 : 0)) || len > (def.max_length ?? 6000)) return null;
      if (len === 0) return null;
      return { value: raw };
    }

    case ApplicationCommandOptionType.Integer:
    case ApplicationCommandOptionType.Number: {
      if (def.choices?.length) {
        const choice = matchChoice(def, raw);
        if (choice !== undefined) return { value: Number(choice) };
        return null;
      }
      const isInt = def.type === ApplicationCommandOptionType.Integer;
      if (isInt ? !INTEGER.test(raw) : !NUMBER.test(raw)) return null;
      const num = isInt ? Number(raw) : Number(raw.replace(',', '.'));
      if (!Number.isFinite(num)) return null;
      if (isInt && !Number.isSafeInteger(num)) return null;
      if (def.min_value !== undefined && num < def.min_value) return null;
      if (def.max_value !== undefined && num > def.max_value) return null;
      return { value: num };
    }

    case ApplicationCommandOptionType.Boolean: {
      const lower = raw.toLowerCase();
      if (TRUE_WORDS.has(lower)) return { value: true };
      if (FALSE_WORDS.has(lower)) return { value: false };
      return null;
    }

    case ApplicationCommandOptionType.User: {
      const id = USER_MENTION.exec(raw)?.[1] ?? (SNOWFLAKE.test(raw) ? raw : null);
      return id ? { value: id } : null;
    }

    case ApplicationCommandOptionType.Role: {
      const id = ROLE_MENTION.exec(raw)?.[1] ?? (SNOWFLAKE.test(raw) ? raw : null);
      return id ? { value: id } : null;
    }

    case ApplicationCommandOptionType.Channel: {
      const id = CHANNEL_MENTION.exec(raw)?.[1] ?? (SNOWFLAKE.test(raw) ? raw : null);
      return id ? { value: id } : null;
    }

    case ApplicationCommandOptionType.Mentionable: {
      const user = USER_MENTION.exec(raw)?.[1];
      if (user) return { value: user, mentionKind: 'user' };
      const role = ROLE_MENTION.exec(raw)?.[1];
      if (role) return { value: role, mentionKind: 'role' };
      if (SNOWFLAKE.test(raw)) return { value: raw, mentionKind: 'unknown' };
      return null;
    }

    default:
      return null;
  }
}

function isText(def: PrefixOptionDef): boolean {
  return def.type === ApplicationCommandOptionType.String;
}

/**
 * Opciones que pueden recibir valor por posición. Una opción de texto opcional
 * que sigue a otra de texto solo puede darse por nombre (evita ambigüedad).
 */
export function positionalDefs(defs: PrefixOptionDef[]): PrefixOptionDef[] {
  const out: PrefixOptionDef[] = [];
  for (const def of defs) {
    if (def.type === ApplicationCommandOptionType.Attachment) continue;
    const prev = out[out.length - 1];
    if (prev && isText(prev) && isText(def) && !def.required) continue;
    out.push(def);
  }
  return out;
}

/**
 * Asigna tokens a opciones. Cada opción de texto toma el mínimo de palabras
 * que permite que el resto encaje; las opcionales que no encajan se saltan.
 */
function assignPositional(defs: PrefixOptionDef[], tokens: PrefixToken[]): ParsedOption[] | null {
  const memo = new Map<string, ParsedOption[] | null>();

  const solve = (d: number, t: number): ParsedOption[] | null => {
    const key = `${d}:${t}`;
    if (memo.has(key)) return memo.get(key)!;
    let result: ParsedOption[] | null = null;

    if (d === defs.length) {
      result = t === tokens.length ? [] : null;
    } else {
      const def = defs[d];
      if (t === tokens.length) {
        result = def.required ? null : solve(d + 1, t);
      } else if (isText(def)) {
        for (let k = 1; k <= tokens.length - t && !result; k++) {
          const raw = tokens.slice(t, t + k).map(tk => tk.value).join(' ');
          const coerced = coerceValue(def, raw);
          if (!coerced) continue;
          const rest = solve(d + 1, t + k);
          if (rest) result = [{ name: def.name, type: def.type, raw, ...coerced }, ...rest];
        }
        if (!result && !def.required) result = solve(d + 1, t);
      } else {
        const raw = tokens[t].value;
        const coerced = coerceValue(def, raw);
        if (coerced) {
          const rest = solve(d + 1, t + 1);
          if (rest) result = [{ name: def.name, type: def.type, raw, ...coerced }, ...rest];
        }
        if (!result && !def.required) result = solve(d + 1, t);
      }
    }

    memo.set(key, result);
    return result;
  };

  return solve(0, 0);
}

/** Explica por qué falló la asignación posicional (primer problema encontrado) */
function diagnose(defs: PrefixOptionDef[], tokens: PrefixToken[]): ParseError {
  let t = 0;
  for (const def of defs) {
    if (t >= tokens.length) {
      if (def.required) return { code: 'missing_option', option: def };
      continue;
    }
    const raw = tokens[t].value;
    if (coerceValue(def, raw)) { t++; continue; }
    if (def.required) return { code: 'invalid_value', option: def, value: raw };
  }
  if (t < tokens.length) return { code: 'too_many_arguments', value: tokens.slice(t).map(tk => tk.value).join(' ') };
  return { code: 'invalid_value', value: tokens.map(tk => tk.value).join(' ') };
}

/**
 * Convierte los tokens restantes en opciones del comando.
 * @param attachmentCount número de adjuntos del mensaje (rellenan opciones de archivo)
 */
export function parseOptions(
  defs: PrefixOptionDef[],
  tokens: PrefixToken[],
  attachmentCount = 0
): { ok: true; options: ParsedOption[] } | { ok: false; error: ParseError } {
  if (tokens.length > MAX_PREFIX_TOKENS) return { ok: false, error: { code: 'too_many_tokens' } };

  const byName = new Map(defs.map(d => [d.name.toLowerCase(), d]));
  const named = new Map<string, ParsedOption>();
  const positional: PrefixToken[] = [];

  // 1) Argumentos con nombre (nombre:valor)
  for (const token of tokens) {
    const def = token.key ? byName.get(token.key.toLowerCase()) : undefined;
    if (!def || def.type === ApplicationCommandOptionType.Attachment
      || def.type === ApplicationCommandOptionType.Subcommand || def.type === ApplicationCommandOptionType.SubcommandGroup) {
      positional.push(token);
      continue;
    }
    if (named.has(def.name)) return { ok: false, error: { code: 'duplicate_option', option: def } };
    const raw = token.keyValue ?? '';
    const coerced = coerceValue(def, raw);
    if (!coerced) return { ok: false, error: { code: 'invalid_value', option: def, value: raw } };
    named.set(def.name, { name: def.name, type: def.type, raw, ...coerced });
  }

  // 2) Adjuntos del mensaje, en orden
  const attachments: ParsedOption[] = [];
  let nextAttachment = 0;
  for (const def of defs) {
    if (def.type !== ApplicationCommandOptionType.Attachment) continue;
    if (nextAttachment < attachmentCount) {
      attachments.push({ name: def.name, type: def.type, value: String(nextAttachment), attachmentIndex: nextAttachment, raw: '' });
      nextAttachment++;
    } else if (def.required) {
      return { ok: false, error: { code: 'missing_attachment', option: def } };
    }
  }

  // 3) Posicionales sobre las opciones que no se dieron por nombre
  const remaining = positionalDefs(defs.filter(d => !named.has(d.name)));
  const assigned = assignPositional(remaining, positional);
  if (!assigned) return { ok: false as const, error: diagnose(remaining, positional) };

  // Opciones obligatorias que solo admiten nombre y no se dieron
  const given = new Set([...named.keys(), ...assigned.map(o => o.name), ...attachments.map(o => o.name)]);
  const missing = defs.find(d => d.required && !given.has(d.name));
  if (missing) return { ok: false, error: { code: 'missing_option', option: missing } };

  // Orden estable: el de la definición del comando
  const all = [...named.values(), ...assigned, ...attachments];
  const order = new Map(defs.map((d, i) => [d.name, i]));
  all.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
  return { ok: true, options: all };
}

/**
 * Texto de uso de una ruta concreta: `<obligatoria> [opcional] [archivo:📎]`.
 * Las opcionales que solo admiten nombre se muestran como `[nombre:…]`.
 */
export function formatUsageArgs(defs: PrefixOptionDef[]): string {
  const positional = new Set(positionalDefs(defs).map(d => d.name));
  return defs
    .map(def => {
      if (def.type === ApplicationCommandOptionType.Attachment) {
        return def.required ? `<${def.name}:📎>` : `[${def.name}:📎]`;
      }
      const label = def.choices?.length && def.choices.length <= 5
        ? `${def.name}: ${def.choices.map(c => String(c.value)).join('|')}`
        : def.name;
      if (!positional.has(def.name)) return `[${def.name}:…]`;
      return def.required ? `<${label}>` : `[${label}]`;
    })
    .join(' ');
}

/**
 * Rutas (grupo/subcomando) de un comando con sus opciones, para la ayuda.
 */
export function listCommandPaths(rootOptions: PrefixOptionDef[] | undefined): { path: string; options: PrefixOptionDef[] }[] {
  const options = rootOptions ?? [];
  if (!hasSubcommands(options)) return [{ path: '', options }];
  const out: { path: string; options: PrefixOptionDef[] }[] = [];
  for (const opt of options) {
    if (opt.type === ApplicationCommandOptionType.Subcommand) {
      out.push({ path: opt.name, options: opt.options ?? [] });
    } else if (opt.type === ApplicationCommandOptionType.SubcommandGroup) {
      for (const sub of opt.options ?? []) {
        if (sub.type === ApplicationCommandOptionType.Subcommand) out.push({ path: `${opt.name} ${sub.name}`, options: sub.options ?? [] });
      }
    }
  }
  return out;
}

/**
 * Detecta el prefijo al principio del mensaje.
 * Devuelve el texto que sigue al prefijo (sin espacios iniciales) o `null`.
 * Acepta también la mención al bot (`<@id>` / `<@!id>`) como prefijo.
 * El prefijo no distingue mayúsculas (los móviles suelen capitalizar).
 */
export function stripPrefix(content: string, prefix: string, botId: string): { body: string; viaMention: boolean } | null {
  const mention = new RegExp(`^<@!?${botId}>`);
  const mentionMatch = mention.exec(content);
  if (mentionMatch) return { body: content.slice(mentionMatch[0].length).trimStart(), viaMention: true };
  if (!prefix) return null;
  if (content.length <= prefix.length) return null;
  if (content.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) return null;
  return { body: content.slice(prefix.length).trimStart(), viaMention: false };
}
