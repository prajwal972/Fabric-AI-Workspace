export function securityHeaders({ production = false } = {}) {
  return {
    'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(self), geolocation=()',
    'cross-origin-resource-policy': 'same-origin',
    'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    ...(production ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
  };
}
