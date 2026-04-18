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
  const password = process.env.ADMIN_PASSWORD || 'H8BnwAPlYg3L02kBMG72';
  const name = process.env.ADMIN_NAME || 'Super Admin';

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`⚠️  Ya existe un operador con email ${email} — seed omitido.`);
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

  console.log('✅ Super admin creado:');
  console.log(`   ID:       ${user.id}`);
  console.log(`   Email:    ${user.email}`);
  console.log(`   Nombre:   ${user.name}`);
  console.log(`   Password: ${password}`);
  console.log('');
  console.log('⚠️  Cambia la contraseña en el panel lo antes posible.');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
