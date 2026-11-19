import type { Context } from 'hono';

export interface OwnerAuthEnv {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  DEV_BYPASS_AUTH?: string;
}

export type OwnerAuthResult =
  | { ok: true; email?: string }
  | { ok: false; status: 401 | 403; error: string };

interface AccessJwk extends JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}

interface JwksResponse {
  keys?: AccessJwk[];
}

interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface JwtPayload {
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  email?: string;
  sub?: string;
}

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const jwksCache = new Map<string, { fetchedAt: number; keys: AccessJwk[] }>();

function normalizeIssuer(teamDomain: string): string {
  const trimmed = teamDomain.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const host = trimmed.includes('.') ? trimmed : `${trimmed}.cloudflareaccess.com`;
  return `https://${host}`;
}

function parseCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      const raw = part.slice(idx + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeJwtParts(token: string): {
  header: JwtHeader;
  payload: JwtPayload;
  signingInput: Uint8Array;
  signature: Uint8Array;
} | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return null;
  }
  try {
    const decoder = new TextDecoder();
    const header = JSON.parse(decoder.decode(base64UrlToBytes(parts[0]))) as JwtHeader;
    const payload = JSON.parse(decoder.decode(base64UrlToBytes(parts[1]))) as JwtPayload;
    const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64UrlToBytes(parts[2]);
    return { header, payload, signingInput, signature };
  } catch {
    return null;
  }
}

async function fetchAccessJwks(issuer: string, forceRefresh = false): Promise<AccessJwk[]> {
  const now = Date.now();
  const cached = jwksCache.get(issuer);
  if (!forceRefresh && cached && now - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cached.keys;
  }

  const res = await fetch(`${issuer}/cdn-cgi/access/certs`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Cloudflare Access JWKS (${res.status})`);
  }
  const data = (await res.json()) as JwksResponse;
  const keys = Array.isArray(data.keys) ? data.keys : [];
  jwksCache.set(issuer, { fetchedAt: now, keys });
  return keys;
}

async function verifyJwtSignature(
  decoded: NonNullable<ReturnType<typeof decodeJwtParts>>,
  issuer: string
): Promise<boolean> {
  if (decoded.header.alg !== 'RS256' || !decoded.header.kid) {
    return false;
  }

  let keys = await fetchAccessJwks(issuer, false);
  let jwk = keys.find((k) => k.kid === decoded.header.kid);
  if (!jwk) {
    keys = await fetchAccessJwks(issuer, true);
    jwk = keys.find((k) => k.kid === decoded.header.kid);
  }
  if (!jwk) {
    return false;
  }

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const sigBuffer = decoded.signature.slice().buffer;
  const inputBuffer = decoded.signingInput.slice().buffer;
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sigBuffer, inputBuffer);
}

/**
 * Verifies that an incoming request belongs to the authenticated AeroLog owner.
 *
 * Mode A (CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD configured):
 *   Full cryptographic RS256 verification against Cloudflare Access JWKS,
 *   enforcing issuer, audience, and token validity window.
 *
 * Mode B (before CF_ACCESS_* secrets are configured):
 *   Allows genuine local development (`localhost`/`127.0.0.1` without `cf-connecting-ip`,
 *   or `DEV_BYPASS_AUTH === 'true'`). For traffic arriving via Cloudflare edge, requires
 *   a well-formed, non-expired `Cf-Access-Jwt-Assertion` header from Zero Trust.
 */
export async function verifyOwnerRequest<E extends OwnerAuthEnv>(
  c: Context<{ Bindings: E }>
): Promise<OwnerAuthResult> {
  const teamDomain = c.env.CF_ACCESS_TEAM_DOMAIN?.trim();
  const expectedAud = c.env.CF_ACCESS_AUD?.trim();
  const assertionHeader = c.req.header('cf-access-jwt-assertion')?.trim() || null;

  // Mode A: Full cryptographic Zero Trust JWT verification
  if (teamDomain && expectedAud) {
    const token = assertionHeader || parseCookieValue(c.req.header('cookie'), 'CF_Authorization');
    if (!token) {
      return { ok: false, status: 401, error: 'Unauthorized: Missing Cloudflare Access token' };
    }

    const decoded = decodeJwtParts(token);
    if (!decoded) {
      return { ok: false, status: 401, error: 'Unauthorized: Malformed Cloudflare Access token' };
    }

    const issuer = normalizeIssuer(teamDomain);
    const nowSec = Math.floor(Date.now() / 1000);
    const { payload } = decoded;

    if (typeof payload.exp !== 'number' || payload.exp <= nowSec - 30) {
      return { ok: false, status: 401, error: 'Unauthorized: Expired Cloudflare Access token' };
    }
    if (typeof payload.nbf === 'number' && payload.nbf > nowSec + 30) {
      return { ok: false, status: 401, error: 'Unauthorized: Token not yet valid' };
    }
    if (payload.iss !== issuer) {
      return { ok: false, status: 403, error: 'Forbidden: Token issuer mismatch' };
    }

    const audList = Array.isArray(payload.aud)
      ? payload.aud
      : typeof payload.aud === 'string'
        ? [payload.aud]
        : [];
    if (!audList.includes(expectedAud)) {
      return { ok: false, status: 403, error: 'Forbidden: Token audience mismatch' };
    }

    try {
      const validSig = await verifyJwtSignature(decoded, issuer);
      if (!validSig) {
        return { ok: false, status: 401, error: 'Unauthorized: Invalid token signature' };
      }
      return { ok: true, email: payload.email || payload.sub };
    } catch (err) {
      console.error('Zero Trust JWKS verification error:', err);
      return { ok: false, status: 401, error: 'Unauthorized: Token verification failed' };
    }
  }

  // Mode B: Pre-configuration fallback (local dev or edge-injected header)
  if (c.env.DEV_BYPASS_AUTH === 'true') {
    return { ok: true, email: 'local-dev' };
  }

  let isLocalHost = false;
  try {
    const reqUrl = new URL(c.req.url);
    isLocalHost = reqUrl.hostname === 'localhost' || reqUrl.hostname === '127.0.0.1';
  } catch {
    isLocalHost = false;
  }

  if (!c.req.header('cf-connecting-ip') && isLocalHost) {
    return { ok: true, email: 'local-dev' };
  }

  if (!assertionHeader) {
    return { ok: false, status: 401, error: 'Unauthorized: Missing Cloudflare Access assertion' };
  }

  const decoded = decodeJwtParts(assertionHeader);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!decoded || typeof decoded.payload.exp !== 'number' || decoded.payload.exp <= nowSec - 30) {
    return { ok: false, status: 401, error: 'Unauthorized: Invalid or expired Access assertion' };
  }

  return { ok: true, email: decoded.payload.email || decoded.payload.sub };
}
