import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

export async function GET(): Promise<NextResponse> {
  const timestamp = new Date().toISOString();

  // Cloudflare nodejs_compat spike: Verify node:crypto Ed25519 keygen, signing, and verification
  let ed25519Status: 'ok' | 'failed' = 'failed';
  let cryptoError: string | undefined;

  try {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const testMessage = Buffer.from(`odc-health-check-${timestamp}`, 'utf8');
    const signature = crypto.sign(null, testMessage, privateKey);
    const verified = crypto.verify(null, testMessage, publicKey, signature);

    if (verified) {
      ed25519Status = 'ok';
    } else {
      cryptoError = 'Signature verification returned false';
    }
  } catch (err: unknown) {
    ed25519Status = 'failed';
    cryptoError = err instanceof Error ? err.message : String(err);
  }

  const isHealthy = ed25519Status === 'ok';

  return NextResponse.json(
    {
      status: isHealthy ? 'ok' : 'degraded',
      timestamp,
      crypto: {
        engine: 'node:crypto',
        ed25519: ed25519Status,
        ...(cryptoError ? { error: cryptoError } : {})
      }
    },
    { status: isHealthy ? 200 : 500 }
  );
}
