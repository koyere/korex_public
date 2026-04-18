/**
 * Seed: Catálogo de items de la tienda
 * Ejecutar: node scripts/seed-shop-items.mjs
 *
 * - Inserta items solo si no existe otro con el mismo nombre en el mismo guild
 * - Seguro para ejecutar múltiples veces (no duplica)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Catálogo escalado: baratos → medios → caros → muy caros
const CATALOG = [
  // ─────────────────────────────────────────────
  // BARATOS  (50 – 300 🪙)
  // ─────────────────────────────────────────────
  {
    name: 'Porción de Pizza',
    emoji: '🍕',
    price: 50,
    type: 'cosmetic',
    description: 'Un trozo de pizza virtual. Nadie sabe cómo llegó aquí, pero se ve deliciosa.',
    stock: -1,
  },
  {
    name: 'Dado de la Suerte',
    emoji: '🎲',
    price: 75,
    type: 'cosmetic',
    description: 'Lánzalo. No pasará nada, pero la sensación es increíble.',
    stock: -1,
  },
  {
    name: 'Carta Misteriosa',
    emoji: '🃏',
    price: 100,
    type: 'consumable',
    description: '¿Qué hay dentro? Nadie lo sabe. Ni tú después de abrirla.',
    stock: -1,
  },
  {
    name: 'Gorra Gamer',
    emoji: '🧢',
    price: 150,
    type: 'cosmetic',
    description: 'Equiparla te hace un 12% más gamer. Estadísticamente hablando.',
    stock: -1,
  },
  {
    name: 'Bola de Cristal (Defectuosa)',
    emoji: '🔮',
    price: 200,
    type: 'consumable',
    description: 'Predice el futuro con un 0.3% de precisión. La garantía expiró.',
    stock: -1,
  },
  {
    name: 'Certificado de Buena Persona',
    emoji: '📜',
    price: 250,
    type: 'cosmetic',
    description: 'Firmado por nadie importante, pero queda bonito en el perfil.',
    stock: -1,
  },

  // ─────────────────────────────────────────────
  // MEDIOS  (350 – 1 000 🪙)
  // ─────────────────────────────────────────────
  {
    name: 'Varita de Hogwarts (Imitación)',
    emoji: '🪄',
    price: 350,
    type: 'cosmetic',
    description: 'No lanza hechizos, pero la onda es absolutamente increíble.',
    stock: -1,
  },
  {
    name: 'Asistente Robot (Versión Gratis)',
    emoji: '🤖',
    price: 450,
    type: 'consumable',
    description: 'Hace exactamente lo que tú harías. Ni más ni menos.',
    stock: -1,
  },
  {
    name: 'Sombrero de Mago VIP',
    emoji: '🎩',
    price: 600,
    type: 'cosmetic',
    description: 'Úsalo para parecer más inteligente en las reuniones de Discord.',
    stock: -1,
  },
  {
    name: 'Taco del Poder',
    emoji: '🌮',
    price: 750,
    type: 'consumable',
    description: 'Se dice que quien lo come obtiene sabiduría infinita. Se dice.',
    stock: 50,
  },
  {
    name: 'Montura de Unicornio',
    emoji: '🦄',
    price: 900,
    type: 'cosmetic',
    description: 'Solo válida en territorios imaginarios. Velocidad: absolutamente ridícula.',
    stock: -1,
  },

  // ─────────────────────────────────────────────
  // CAROS  (1 200 – 5 000 🪙)
  // ─────────────────────────────────────────────
  {
    name: 'Maletín Ejecutivo Vacío',
    emoji: '💼',
    price: 1200,
    type: 'cosmetic',
    description: 'Parece que sabes lo que haces. El secreto está en la pose.',
    stock: -1,
  },
  {
    name: 'Cohete Personal (Sin Combustible)',
    emoji: '🚀',
    price: 1800,
    type: 'cosmetic',
    description: 'Llega a las estrellas… teóricamente. Combustible vendido por separado.',
    stock: -1,
  },
  {
    name: 'Escudo Anti-Críticas',
    emoji: '🛡️',
    price: 2200,
    type: 'consumable',
    description: 'Absorbe hasta 3 críticas de tus amigos. Duración: un rato.',
    stock: 30,
  },
  {
    name: 'Corona del Servidor',
    emoji: '👑',
    price: 2500,
    type: 'cosmetic',
    description: 'Símbolo de estatus máximo. No da poderes reales, solo respeto.',
    stock: -1,
  },
  {
    name: 'Diamante de la Eternidad',
    emoji: '💎',
    price: 4000,
    type: 'cosmetic',
    description: 'Raro, brillante y completamente inútil. Como toda buena obra de arte.',
    stock: -1,
  },

  // ─────────────────────────────────────────────
  // MUY CAROS  (6 000 – 15 000 🪙)
  // ─────────────────────────────────────────────
  {
    name: 'Trofeo de Leyenda Absoluta',
    emoji: '🏆',
    price: 6000,
    type: 'cosmetic',
    description: 'Para quien llegó hasta aquí. Eso ya merece respeto en sí mismo.',
    stock: -1,
  },
  {
    name: 'Estrella del Servidor',
    emoji: '🌟',
    price: 8000,
    type: 'cosmetic',
    description: 'Tu nombre en las estrellas. Bueno, en el inventario. Que es casi lo mismo.',
    stock: -1,
  },
  {
    name: 'Ticket Dorado de Lotería',
    emoji: '🎰',
    price: 10000,
    type: 'consumable',
    description: 'La suerte es para los valientes. O para los ricos. Tú decides.',
    stock: 10,
  },
  {
    name: 'Traje de Millonario',
    emoji: '🤵',
    price: 12000,
    type: 'cosmetic',
    description: 'Porque si ya tienes 12,000 monedas, claramente sabes lo que haces.',
    stock: -1,
  },
  {
    name: 'Portal Interdimensional',
    emoji: '🌀',
    price: 15000,
    type: 'consumable',
    description: 'Se abre, te metes, apareces en el mismo servidor. Pero fue emocionante.',
    stock: 5,
  },
];

async function main() {
  // Obtener todos los guilds registrados
  const guilds = await prisma.guild.findMany({ select: { id: true } });

  if (guilds.length === 0) {
    console.log('No hay guilds registrados en la BD. Nada que hacer.');
    return;
  }

  console.log(`\nGuilds encontrados: ${guilds.length}`);
  let totalInserted = 0;
  let totalSkipped = 0;

  for (const guild of guilds) {
    console.log(`\n→ Guild: ${guild.id}`);

    // Obtener nombres de items ya existentes en este guild
    const existing = await prisma.shopItem.findMany({
      where: { guildId: guild.id },
      select: { name: true },
    });
    const existingNames = new Set(existing.map(i => i.name));

    for (const item of CATALOG) {
      if (existingNames.has(item.name)) {
        console.log(`  SKIP  ${item.emoji} ${item.name} (ya existe)`);
        totalSkipped++;
        continue;
      }

      await prisma.shopItem.create({
        data: {
          guildId: guild.id,
          name: item.name,
          description: item.description,
          price: item.price,
          type: item.type,
          emoji: item.emoji,
          stock: item.stock,
          enabled: true,
        },
      });

      console.log(`  INSERT ${item.emoji} ${item.name} — ${item.price} 🪙`);
      totalInserted++;
    }
  }

  console.log(`\n✅ Completado: ${totalInserted} items insertados, ${totalSkipped} omitidos.`);
}

main()
  .catch(e => { console.error('Error:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
