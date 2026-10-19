import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { generateEd25519GrantKeyPair } from '../packages/contracts/src/security.js';

/**
 * Production & Staging Cryptographic Secret Provisioning Generator
 * Generates:
 * - Ed25519 Keypair (Private for Web Portal / Public for Desktop Stations)
 * - 32-byte Cryptographic Token Pepper Secret
 * - 32-byte Random Cron Worker Secret
 */
function generateSecrets() {
  console.log('Generating cryptographic keypairs and tokens for ODC-PhotoStudio...\n');

  const { publicKeyPem, privateKeyPem } = generateEd25519GrantKeyPair();
  const tokenPepper = crypto.randomBytes(32).toString('hex');
  const cronSecret = crypto.randomBytes(32).toString('hex');

  const serverEnvContent = `# --- Generated Server Secrets (${new Date().toISOString()}) ---
# DO NOT COMMIT REAL PRODUCTION KEYS TO VERSION CONTROL

OFFLINE_GRANT_PRIVATE_KEY_PEM="${privateKeyPem.replace(/\n/g, '\\n')}"
OFFLINE_GRANT_PUBLIC_KEY_PEM="${publicKeyPem.replace(/\n/g, '\\n')}"
TOKEN_PEPPER_SECRET="${tokenPepper}"
CRON_WORKER_SECRET="${cronSecret}"
`;

  const clientEnvContent = `# --- Generated Client Station Config (${new Date().toISOString()}) ---
# Only public verification keys and local station identifiers belong here

OFFLINE_GRANT_PUBLIC_KEY_PEM="${publicKeyPem.replace(/\n/g, '\\n')}"
ODC_PORTAL_API_URL="http://localhost:3000"
ODC_DESKTOP_MODE="mock"
ODC_STATION_ID="00000000-0000-4000-8000-000000000001"
`;

  const targetDir = path.resolve(process.cwd(), 'tmp', 'provisioned-keys');
  fs.mkdirSync(targetDir, { recursive: true });

  fs.writeFileSync(path.join(targetDir, 'server-secrets.env'), serverEnvContent);
  fs.writeFileSync(path.join(targetDir, 'desktop-station.env'), clientEnvContent);

  console.log(`Generated secrets successfully in: ${targetDir}`);
  console.log('- server-secrets.env (for Vercel / Cloud Portal)');
  console.log('- desktop-station.env (for Operator Desktop stations)');
  console.log('\nToken Pepper (hex):', tokenPepper);
  console.log('Cron Secret (hex):', cronSecret);
}

generateSecrets();
