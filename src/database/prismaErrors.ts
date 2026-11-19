import { Prisma } from '@prisma/client';

/**
 * Columns or index of the violated unique constraint in a P2002 error.
 *
 * Prisma 6's native engine reported it in `meta.target` (list of columns); with
 * Prisma 7 driver adapters it arrives in `meta.driverAdapterError.cause.constraint`
 * as `{ fields }` or as `{ index }` (the index name, which includes the
 * columns: `table_col1_col2_key`). Both shapes are accepted.
 */
export function uniqueViolationTarget(error: Prisma.PrismaClientKnownRequestError): string {
  const meta = (error.meta ?? {}) as Record<string, any>;

  if (meta.target !== undefined && meta.target !== null) {
    return Array.isArray(meta.target) ? meta.target.join(',') : String(meta.target);
  }

  const constraint = meta.driverAdapterError?.cause?.constraint;

  if (Array.isArray(constraint?.fields)) return constraint.fields.join(',');
  if (typeof constraint?.index === 'string') return constraint.index;

  return '';
}
