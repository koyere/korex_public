/**
 * LogStream — singleton EventEmitter para streaming de logs en tiempo real.
 * El Logger emite aquí; el endpoint SSE de admin escucha aquí.
 * Funciona dentro del mismo proceso sin necesidad de Redis pub/sub.
 */

import { EventEmitter } from 'events';

export interface LiveLogEntry {
  ts:       string;
  level:    string;
  service?: string;
  message:  string;
}

class LogStreamEmitter extends EventEmitter {}

export const logStream = new LogStreamEmitter();

// Permite muchos clientes SSE simultáneos sin warnings de memory leak
logStream.setMaxListeners(200);
