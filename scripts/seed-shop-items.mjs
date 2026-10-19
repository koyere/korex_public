/**
 * Seed: Catálogo de items de la tienda
 * Ejecutar: node scripts/seed-shop-items.mjs
 *
 * - Inserta items solo si no existe otro con el mismo nombre en el mismo guild
 * - Seguro para ejecutar múltiples veces (no duplica)
 * - translationKey permite traducir el nombre/descripción en bot y web
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CATALOG = [
  { translationKey: 'pizza',        name: 'Porción de Pizza',              emoji: '🍕', price: 50,    type: 'cosmetic',   stock: -1 },
  { translationKey: 'dice',         name: 'Dado de la Suerte',             emoji: '🎲', price: 75,    type: 'cosmetic',   stock: -1 },
  { translationKey: 'mystery_card', name: 'Carta Misteriosa',              emoji: '🃏', price: 100,   type: 'consumable', stock: -1 },
  { translationKey: 'gamer_cap',    name: 'Gorra Gamer',                   emoji: '🧢', price: 150,   type: 'cosmetic',   stock: -1 },
  { translationKey: 'crystal_ball', name: 'Bola de Cristal (Defectuosa)',  emoji: '🔮', price: 200,   type: 'consumable', stock: -1 },
  { translationKey: 'certificate',  name: 'Certificado de Buena Persona',  emoji: '📜', price: 250,   type: 'cosmetic',   stock: -1 },
  { translationKey: 'magic_wand',   name: 'Varita de Hogwarts (Imitación)',emoji: '🪄', price: 350,   type: 'cosmetic',   stock: -1 },
  { translationKey: 'robot',        name: 'Asistente Robot (Versión Gratis)',emoji:'🤖',price: 450,   type: 'consumable', stock: -1 },
  { translationKey: 'wizard_hat',   name: 'Sombrero de Mago VIP',          emoji: '🎩', price: 600,   type: 'cosmetic',   stock: -1 },
  { translationKey: 'power_taco',   name: 'Taco del Poder',                emoji: '🌮', price: 750,   type: 'consumable', stock: 50  },
  { translationKey: 'unicorn',      name: 'Montura de Unicornio',          emoji: '🦄', price: 900,   type: 'cosmetic',   stock: -1 },
  { translationKey: 'briefcase',    name: 'Maletín Ejecutivo Vacío',       emoji: '💼', price: 1200,  type: 'cosmetic',   stock: -1 },
  { translationKey: 'rocket',       name: 'Cohete Personal (Sin Combustible)', emoji: '🚀', price: 1800, type: 'cosmetic', stock: -1 },
  { translationKey: 'shield',       name: 'Escudo Anti-Críticas',          emoji: '🛡️', price: 2200,  type: 'consumable', stock: 30  },
  { translationKey: 'crown',        name: 'Corona del Servidor',           emoji: '👑', price: 2500,  type: 'cosmetic',   stock: -1 },
  { translationKey: 'diamond',      name: 'Diamante de la Eternidad',      emoji: '💎', price: 4000,  type: 'cosmetic',   stock: -1 },
  { translationKey: 'trophy',       name: 'Trofeo de Leyenda Absoluta',    emoji: '🏆', price: 6000,  type: 'cosmetic',   stock: -1 },
  { translationKey: 'star',         name: 'Estrella del Servidor',         emoji: '🌟', price: 8000,  type: 'cosmetic',   stock: -1 },
  { translationKey: 'lottery',      name: 'Ticket Dorado de Lotería',      emoji: '🎰', price: 10000, type: 'consumable', stock: 10  },
  { translationKey: 'suit',         name: 'Traje de Millonario',           emoji: '🤵', price: 12000, type: 'cosmetic',   stock: -1 },
  { translationKey: 'portal',       name: 'Portal Interdimensional',       emoji: '🌀', price: 15000, type: 'consumable', stock: 5   },
];

// Descriptions are now handled via translationKey — stored as fallback for unknown languages
const DESCRIPTIONS = {
  pizza:        'Un trozo de pizza virtual. Nadie sabe cómo llegó aquí, pero se ve deliciosa.',
  dice:         'Lánzalo. No pasará nada, pero la sensación es increíble.',
  mystery_card: '¿Qué hay dentro? Nadie lo sabe. Ni tú después de abrirla.',
  gamer_cap:    'Equiparla te hace un 12% más gamer. Estadísticamente hablando.',
  crystal_ball: 'Predice el futuro con un 0.3% de precisión. La garantía expiró.',
  certificate:  'Firmado por nadie importante, pero queda bonito en el perfil.',
  magic_wand:   'No lanza hechizos, pero la onda es absolutamente increíble.',
  robot:        'Hace exactamente lo que tú harías. Ni más ni menos.',
  wizard_hat:   'Úsalo para parecer más inteligente en las reuniones de Discord.',
  power_taco:   'Se dice que quien lo come obtiene sabiduría infinita. Se dice.',
  unicorn:      'Solo válida en territorios imaginarios. Velocidad: absolutamente ridícula.',
  briefcase:    'Parece que sabes lo que haces. El secreto está en la pose.',
  rocket:       'Llega a las estrellas… teóricamente. Combustible vendido por separado.',
  shield:       'Absorbe hasta 3 críticas de tus amigos. Duración: un rato.',
  crown:        'Símbolo de estatus máximo. No da poderes reales, solo respeto.',
  diamond:      'Raro, brillante y completamente inútil. Como toda buena obra de arte.',
  trophy:       'Para quien llegó hasta aquí. Eso ya merece respeto en sí mismo.',
  star:         'Tu nombre en las estrellas. Bueno, en el inventario. Que es casi lo mismo.',
  lottery:      'La suerte es para los valientes. O para los ricos. Tú decides.',
  suit:         'Porque si ya tienes 12,000 monedas, claramente sabes lo que haces.',
  portal:       'Se abre, te metes, apareces en el mismo servidor. Pero fue emocionante.',
};

async function main() {
  const guilds = await prisma.guild.findMany({ select: { id: true } });

  if (guilds.length === 0) {
    console.log('No hay guilds registrados en la BD. Nada que hacer.');
    return;
  }

  console.log(`\nGuilds encontrados: ${guilds.length}`);
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const guild of guilds) {
    console.log(`\n→ Guild: ${guild.id}`);

    for (const item of CATALOG) {
      const existing = await prisma.shopItem.findFirst({
        where: { guildId: guild.id, name: item.name },
      });

      if (existing) {
        if (!existing.translationKey) {
          await prisma.shopItem.update({
            where: { id: existing.id },
            data: { translationKey: item.translationKey },
          });
          console.log(`  UPDATE ${item.emoji} ${item.name} → translationKey: ${item.translationKey}`);
          totalUpdated++;
        } else {
          console.log(`  SKIP   ${item.emoji} ${item.name}`);
          totalSkipped++;
        }
        continue;
      }

      await prisma.shopItem.create({
        data: {
          guildId: guild.id,
          name: item.name,
          description: DESCRIPTIONS[item.translationKey],
          translationKey: item.translationKey,
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

  console.log(`\n✅ Completado: ${totalInserted} insertados, ${totalUpdated} actualizados con translationKey, ${totalSkipped} omitidos.`);
}

main()
  .catch(e => { console.error('Error:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
