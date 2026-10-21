// Public parent documents load reviewed same-origin scripts. Generated maker
// previews inherit this policy: their inert inline CSS and blob frames must
// remain usable, without permitting inline or evaluated JavaScript.
export const PUBLIC_HTML_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://cloudflare-dns.com",
  "frame-src 'self' blob:",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "worker-src 'none'",
  "media-src 'none'"
].join("; ");
