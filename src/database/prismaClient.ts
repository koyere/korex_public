import { availableParallelism } from 'os';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Prisma 7 no longer ships its own query engine: the client connects to
 * PostgreSQL through the `pg` driver adapter. This factory centralizes that
 * connection for the bot and the scripts.
 *
 * The pool is sized and timed like the Prisma 6 engine so behavior under load
 * does not change:
 *   - default size: cores * 2 + 1 (`connection_limit` in the URL overrides it)
 *   - maximum wait for a connection: 10 s, Prisma 6's `pool_timeout` (in `pg`
 *     the same limit covers opening it and waiting for a turn; `connect_timeout`
 *     and `pool_timeout` in the URL override it, the larger one wins)
 *   - `schema` in the URL is honored as in Prisma 6
 */
type ClientOptions = Omit<Prisma.PrismaClientOptions, 'adapter' | 'accelerateUrl'>;

export interface PrismaClientFactoryOptions extends ClientOptions {
  /** Connection to use; defaults to `process.env.DATABASE_URL`. */
  connectionString?: string;
  /** Errors from idle pool connections (e.g. a PostgreSQL restart). */
  onPoolError?: (error: Error) => void;
}

function positiveInt(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const n = parseInt(value, 10);

  return n > 0 ? n : undefined;
}

export function createPrismaClient(options: PrismaClientFactoryOptions = {}): PrismaClient {
  const { connectionString = process.env.DATABASE_URL, onPoolError, ...clientOptions } = options;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not defined');
  }

  let params: URLSearchParams;

  try {
    params = new URL(connectionString).searchParams;
  } catch {
    params = new URLSearchParams();
  }

  const max = positiveInt(params.get('connection_limit')) ?? availableParallelism() * 2 + 1;
  const timeoutSecs = Math.max(
    positiveInt(params.get('connect_timeout')) ?? 5,
    positiveInt(params.get('pool_timeout')) ?? 10,
  );
  const schema = params.get('schema') || undefined;

  const adapter = new PrismaPg(
    {
      connectionString,
      max,
      connectionTimeoutMillis: timeoutSecs * 1000,
    },
    { schema, onPoolError },
  );

  return new PrismaClient({ ...clientOptions, adapter });
}
