import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const ARGON2_OPTIONS: argon2.Options & { raw: false } = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  raw: false,
};

async function main() {
  const email = process.env.ADMIN_EMAIL || 'admin@korex.dev';
  if (!process.env.ADMIN_PASSWORD) {
    console.error('❌ ADMIN_PASSWORD env var is required — refusing to seed with a hardcoded default password');
    process.exit(1);
  }
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || 'Super Admin';

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`⚠️  An operator with email ${email} already exists — seed skipped.`);
    return;
  }

  const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

  const user = await prisma.adminUser.create({
    data: {
      email,
      passwordHash,
      name,
      role: 'super_admin',
    },
  });

  console.log('✅ Super admin created:');
  console.log(`   ID:       ${user.id}`);
  console.log(`   Email:    ${user.email}`);
  console.log(`   Name:     ${user.name}`);
  console.log('   Password: [set via ADMIN_PASSWORD env var — not logged]');
  console.log('');
  console.log('⚠️  Change the password in the panel as soon as possible.');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
