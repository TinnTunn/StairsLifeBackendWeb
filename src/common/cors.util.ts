/**
 * Bangun daftar origin yang diizinkan untuk CORS (REST + WebSocket).
 *
 * - FRONTEND_URL bisa berisi multiple origin dipisah koma.
 * - Di development, localhost:5173 (Vite default) selalu diizinkan
 *   walaupun tidak ada di FRONTEND_URL — supaya developer tidak terjebak.
 *
 * Di-share antara main.ts (REST) dan WebSocket gateways supaya
 * tidak ada drift konfigurasi.
 */
export function buildCorsOriginList(): string[] {
  const fromEnv = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const isDev = (process.env.NODE_ENV || 'development') !== 'production';
  const devDefaults = isDev
    ? [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
      ]
    : [];

  return Array.from(new Set([...fromEnv, ...devDefaults]));
}
