// Prisma 7 CLI configuration (generate, migrate, db push, studio).
// Prisma 7 no longer loads .env on its own nor accepts the URL in schema.prisma.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'src/database/prisma/schema.prisma',
  datasource: {
    // generate needs no connection: without DATABASE_URL only the commands that use it fail
    url: process.env.DATABASE_URL ?? '',
  },
});
