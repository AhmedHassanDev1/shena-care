import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export class AdapterError extends Error {}

// Do not return raw transport errors: they can contain URLs, headers or credentials.
export function safeError(error: unknown): string {
  if (error instanceof AdapterError) return error.message;
  const cause = error instanceof Error ? error.cause : undefined;
  const causeCode = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
  if (['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(String(causeCode))) {
    return 'TLS certificate verification failed. Configure Node with your trusted system or organization CA using NODE_EXTRA_CA_CERTS; keep TLS verification enabled.';
  }
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 401 || code === 403) return 'Stitch authentication or permission failed. Check the key/token, account access and quota project.';
  if (code === 429) return 'Stitch rate limit reached. Wait before retrying a read. Check project state before retrying a write.';
  if (code === -32001 || (error instanceof Error && /timeout|abort/i.test(error.name + error.message))) {
    return 'Request timed out or was cancelled. A remote write may still finish; check project screens before retrying.';
  }
  return 'Stitch request failed. Check connectivity, credentials and service availability. No automatic retry was performed.';
}

export function errorResult(error: unknown): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: safeError(error) }] };
}
