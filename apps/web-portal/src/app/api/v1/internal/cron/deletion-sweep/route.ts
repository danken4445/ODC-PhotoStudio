import { NextResponse, type NextRequest } from 'next/server';
import { getCloudPortalRepository } from '@/lib/supabase-repository';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const configuredSecret = process.env.CRON_WORKER_SECRET;
    const authHeader = request.headers.get('authorization');

    // Secured by Bearer CRON_WORKER_SECRET
    if (configuredSecret && configuredSecret !== 'replace-with-cron-worker-bearer-secret') {
      const expected = `Bearer ${configuredSecret}`;
      if (!authHeader || authHeader !== expected) {
        return NextResponse.json(
          { error: 'UNAUTHORIZED', message: 'Invalid or missing CRON_WORKER_SECRET bearer token' },
          { status: 401 }
        );
      }
    }

    const repo = getCloudPortalRepository();
    const result = await repo.runScheduledDeletionSweep(new Date().toISOString());

    return NextResponse.json(
      {
        apiVersion: 'v1',
        executedAt: new Date().toISOString(),
        result
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'INTERNAL_SERVER_ERROR';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
