import { createCanvas } from 'canvas';
import { randomInt } from 'crypto';

/**
 * Generación de captchas de imagen para la verificación de miembros.
 *
 * El alfabeto excluye los caracteres ambiguos (0/O, 1/I/L) y se usa solo en
 * mayúsculas, así que la comparación puede hacerse sin distinguir mayúsculas.
 */
export const CAPTCHA_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CAPTCHA_LENGTH = 6;

/** Código aleatorio criptográficamente seguro. */
export function generateCaptchaCode(length: number = CAPTCHA_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i++) code += CAPTCHA_ALPHABET[randomInt(CAPTCHA_ALPHABET.length)];
  return code;
}

/** Normaliza lo que escribe el usuario: sin espacios/guiones y en mayúsculas. */
export function normalizeCaptchaInput(raw: string): string {
  return (raw || '').replace(/[\s-]+/g, '').toUpperCase().slice(0, 32);
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** Dibuja el código con ruido (líneas, puntos, arcos) y una distorsión ondulada. Devuelve PNG. */
export function renderCaptchaImage(code: string): Buffer {
  const width = 320;
  const height = 110;

  // 1) Texto sobre un lienzo intermedio
  const text = createCanvas(width, height);
  const t = text.getContext('2d');

  const bg = t.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, `hsl(${randomInt(360)}, 25%, 88%)`);
  bg.addColorStop(1, `hsl(${randomInt(360)}, 25%, 80%)`);
  t.fillStyle = bg;
  t.fillRect(0, 0, width, height);

  // Ruido de fondo: puntos
  for (let i = 0; i < 400; i++) {
    t.fillStyle = `hsla(${randomInt(360)}, 40%, ${randomInt(30, 70)}%, 0.5)`;
    t.fillRect(rand(0, width), rand(0, height), rand(1, 3), rand(1, 3));
  }

  // Caracteres con rotación, tamaño y posición variables
  const slot = (width - 40) / code.length;
  t.textBaseline = 'middle';
  t.textAlign = 'center';
  for (let i = 0; i < code.length; i++) {
    const size = randomInt(42, 54);
    t.save();
    t.translate(20 + slot * i + slot / 2 + rand(-4, 4), height / 2 + rand(-10, 10));
    t.rotate(rand(-0.4, 0.4));
    t.font = `bold ${size}px "DejaVu Sans", sans-serif`;
    t.fillStyle = `hsl(${randomInt(360)}, 65%, ${randomInt(18, 35)}%)`;
    t.fillText(code[i], 0, 0);
    t.restore();
  }

  // Líneas y arcos que cruzan el texto
  for (let i = 0; i < 6; i++) {
    t.strokeStyle = `hsla(${randomInt(360)}, 60%, ${randomInt(20, 45)}%, 0.75)`;
    t.lineWidth = rand(1.5, 3);
    t.beginPath();
    t.moveTo(rand(0, width * 0.3), rand(0, height));
    t.bezierCurveTo(rand(0, width), rand(0, height), rand(0, width), rand(0, height), rand(width * 0.7, width), rand(0, height));
    t.stroke();
  }

  // 2) Distorsión: desplaza cada columna en vertical siguiendo una onda
  const out = createCanvas(width, height);
  const o = out.getContext('2d');
  o.drawImage(text, 0, 0); // base para que el desplazamiento no deje huecos
  const amplitude = rand(4, 7);
  const period = rand(40, 70);
  const phase = rand(0, Math.PI * 2);
  for (let x = 0; x < width; x += 2) {
    const dy = Math.sin(x / period + phase) * amplitude;
    o.drawImage(text, x, 0, 2, height, x, dy, 2, height);
  }

  // Puntos finales por encima de la distorsión
  for (let i = 0; i < 120; i++) {
    o.fillStyle = `hsla(${randomInt(360)}, 50%, ${randomInt(20, 60)}%, 0.6)`;
    o.fillRect(rand(0, width), rand(0, height), 2, 2);
  }

  return out.toBuffer('image/png');
}
