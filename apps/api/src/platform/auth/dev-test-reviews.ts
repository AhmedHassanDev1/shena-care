import { Role } from '@prisma/client';

const ALLOWED_LOCAL_ENVS = new Set(['development', 'test']);
const BLOCKED_DEPLOY_ENVS = new Set(['production', 'prod', 'staging', 'preview', 'live']);
const SECONDARY_ENV_KEYS = [
  'APP_ENV',
  'ENVIRONMENT',
  'DEPLOY_ENV',
  'SHINACARE_ENV',
  'VERCEL_ENV',
  'RAILWAY_ENVIRONMENT',
  'RAILWAY_ENVIRONMENT_NAME',
  'RENDER_ENV',
] as const;

export interface DevReviewerCandidate {
  id: string;
  email?: string | null;
  roles?: readonly Role[] | null;
  isActive?: boolean | null;
}

function parseCsvSet(value: string | undefined, lowercase = false): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => (lowercase ? entry.toLowerCase() : entry)),
  );
}

/**
 * Isolated environment gate for development-only test reviews.
 * Fail-closed: only allows 'development' or 'test' NODE_ENV, rejects missing/unknown
 * NODE_ENV and any secondary deployment variable indicating staging or production,
 * and never consults TEST_BYPASS_AUTH.
 */
export function isDevTestReviewEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  const nodeEnv = (env.NODE_ENV ?? '').trim().toLowerCase();
  if (!ALLOWED_LOCAL_ENVS.has(nodeEnv)) {
    return false;
  }

  for (const key of SECONDARY_ENV_KEYS) {
    const raw = (env[key] ?? '').trim().toLowerCase();
    if (!raw) continue;
    if (BLOCKED_DEPLOY_ENVS.has(raw)) {
      return false;
    }
  }

  return true;
}

/**
 * Explicit development-only feature flag (disabled by default).
 */
export function isDevTestReviewFlagEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isDevTestReviewEnvironment(env) && env.ENABLE_DEV_TEST_REVIEWS === 'true';
}

/**
 * Requires an active authenticated authorized developer (ADMIN role or explicit
 * local dev allowlist) and only passes when the isolated dev-test flag is enabled.
 */
export function isAuthorizedDevReviewer(
  user: DevReviewerCandidate | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isDevTestReviewFlagEnabled(env)) {
    return false;
  }
  if (!user || !user.id || user.isActive === false) {
    return false;
  }
  const roles = Array.isArray(user.roles) ? user.roles : [];
  if (roles.includes(Role.ADMIN)) {
    return true;
  }

  const allowedUserIds = parseCsvSet(env.DEV_TEST_REVIEW_USER_IDS, false);
  if (allowedUserIds.has(user.id)) {
    return true;
  }

  const normalizedEmail = user.email?.trim().toLowerCase();
  if (normalizedEmail) {
    const allowedEmails = parseCsvSet(env.DEV_TEST_REVIEW_EMAILS, true);
    if (allowedEmails.has(normalizedEmail)) {
      return true;
    }
  }

  return false;
}
