/**
 * LogStream — singleton EventEmitter for real-time log streaming.
 * The Logger emits here; the admin SSE endpoint listens here.
 * Works within the same process without needing Redis pub/sub.
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

// Allows many simultaneous SSE clients without memory leak warnings
logStream.setMaxListeners(200);
