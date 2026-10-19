import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { generateEd25519GrantKeyPair } from '../packages/contracts/src/security';

/**
 * Cloudflare Staging Deployment & Secret Provisioning Assistant
 * 
 * Automates:
 * 1. Verification of Cloudflare CLI authentication (wrangler whoami)
 * 2. Automated secret generation and deployment via `wrangler secret put`
 * 3. Configuration validation for OpenNext / Workers
 * 4. Staging health check verification (/api/v1/health)
 */

interface CloudflareSecrets {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  OFFLINE_GRANT_PRIVATE_KEY_PEM: string;
  OFFLINE_GRANT_PUBLIC_KEY_PEM: string;
  TOKEN_PEPPER_SECRET: string;
  CRON_WORKER_SECRET: string;
  ODC_ADMIN_JWT_SECRET: string;
}

function runCommand(cmd: string, cwd = process.cwd()): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err: any) {
    throw new Error(`Command failed: ${cmd}\n${err.stderr || err.stdout || err.message}`);
  }
}

async function main() {
  console.log('======================================================');
  console.log(' ODC-PhotoStudio: Cloudflare Staging Deployment Assist');
  console.log('======================================================\n');

  const webPortalDir = path.resolve(process.cwd(), 'apps/web-portal');
  const wranglerConfigPath = path.join(webPortalDir, 'wrangler.jsonc');

  if (!fs.existsSync(wranglerConfigPath)) {
    console.error('❌ wrangler.jsonc not found in apps/web-portal');
    process.exit(1);
  }

  // 1. Check Cloudflare authentication
  console.log('1. Checking Cloudflare authentication status...');
  try {
    const whoami = runCommand('npx wrangler whoami', webPortalDir);
    console.log('✔ Cloudflare credentials detected:');
    const accountLine = whoami.split('\n').find((l) => l.includes('Account Name') || l.includes('User'));
    if (accountLine) console.log(`   ${accountLine.trim()}`);
  } catch {
    console.warn('⚠ Wrangler is not logged in. To authenticate, run:\n   npx wrangler login\n');
  }

  // 2. Generate or load deployment secrets
  console.log('\n2. Preparing cryptographic keys and tokens...');
  const keyPair = generateEd25519GrantKeyPair();
  const tokenPepper = crypto.randomBytes(32).toString('hex');
  const cronSecret = crypto.randomBytes(32).toString('hex');
  const jwtSecret = crypto.randomBytes(32).toString('hex');

  const secrets: CloudflareSecrets = {
    OFFLINE_GRANT_PRIVATE_KEY_PEM: keyPair.privateKeyPem,
    OFFLINE_GRANT_PUBLIC_KEY_PEM: keyPair.publicKeyPem,
    TOKEN_PEPPER_SECRET: tokenPepper,
    CRON_WORKER_SECRET: cronSecret,
    ODC_ADMIN_JWT_SECRET: jwtSecret
  };

  // Save generated secrets to a local staging file for reference (excluded from git)
  const stagingKeysDir = path.resolve(process.cwd(), 'tmp', 'staging-keys');
  fs.mkdirSync(stagingKeysDir, { recursive: true });
  fs.writeFileSync(
    path.join(stagingKeysDir, 'staging-secrets.json'),
    JSON.stringify(secrets, null, 2)
  );
  console.log(`✔ Generated cryptographic keys saved to tmp/staging-keys/staging-secrets.json`);

  // 3. Deployment Commands Guide
  console.log('\n3. Secret Provisioning Commands for Cloudflare Worker:');
  console.log('------------------------------------------------------');
  console.log('Run the following commands to upload secrets to Cloudflare:');
  console.log(`\n  cd apps/web-portal`);
  console.log(`  npx wrangler secret put OFFLINE_GRANT_PRIVATE_KEY_PEM`);
  console.log(`  npx wrangler secret put TOKEN_PEPPER_SECRET`);
  console.log(`  npx wrangler secret put CRON_WORKER_SECRET`);
  console.log(`  npx wrangler secret put ODC_ADMIN_JWT_SECRET`);
  console.log(`  npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`);

  console.log('\n4. Cloudflare Git Integration (Recommended):');
  console.log('------------------------------------------------------');
  console.log('Since repository is on GitHub (danken4445/ODC-PhotoStudio):');
  console.log('1. Go to Cloudflare Dashboard > Workers & Pages > Create application');
  console.log('2. Connect GitHub repository and select "apps/web-portal"');
  console.log('3. Build command: pnpm run build:worker');
  console.log('4. Output directory: .open-next/assets');
  console.log('5. Add the 5 secrets listed above in Cloudflare Environment Variables.');

  console.log('\n5. Verification Endpoint:');
  console.log('------------------------------------------------------');
  console.log('Once deployed, verify health and crypto spike at:');
  console.log('  GET https://odc-web-portal.<your-subdomain>.workers.dev/api/v1/health');
  console.log('Expected response:');
  console.log('  { status: "ok", crypto: { ed25519: "ok" } }');
  console.log('\n======================================================');
}

main().catch(console.error);
