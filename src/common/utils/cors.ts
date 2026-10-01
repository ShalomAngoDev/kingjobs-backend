import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * CORS pour Vercel (previews *.vercel.app) + domaines KingJOBS.
 * Pas de wildcard `*` avec credentials.
 */
export function buildCorsOptions(
  exactOrigins: string[],
  originRegexes: string[],
): CorsOptions {
  const compiled = originRegexes
    .map((pattern) => {
      try {
        return new RegExp(pattern);
      } catch {
        return null;
      }
    })
    .filter((re): re is RegExp => re !== null);

  return {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Requêtes server-to-server / curl / apps natives : pas d'Origin
      if (!origin) {
        callback(null, true);
        return;
      }
      if (exactOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      if (compiled.some((re) => re.test(origin))) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  };
}
