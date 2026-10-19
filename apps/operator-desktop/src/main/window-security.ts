export const SECURITY_WINDOW_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false
} as const;

export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: odc-media:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'";
