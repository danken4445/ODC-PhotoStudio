import { NextResponse, type NextRequest } from 'next/server';
import {
  ApprovedSessionManifestSchema,
  FinalizeSessionRequestSchema,
  type ApprovedSessionManifest,
  type FinalizeSessionResponse
} from '@odc-photostudio/contracts';
import { extractActorUserId } from '@/lib/api-auth';
import { getCloudPortalRepository } from '@/lib/supabase-repository';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  try {
    const { sessionId } = await params;
    const body = await request.json();

    const extendedSchema = FinalizeSessionRequestSchema.extend({
      manifest: ApprovedSessionManifestSchema.optional()
    });

    const parsed = extendedSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'INVALID_REQUEST', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { idempotencyKey, tenantId, eventId, manifest } = parsed.data;
    const actorUserId = await extractActorUserId(request);
    if (!actorUserId) {
      return NextResponse.json(
        { error: 'UNAUTHENTICATED', message: 'Bearer token or x-actor-user-id is required' },
        { status: 401 }
      );
    }

    const repo = getCloudPortalRepository();
    const serverTimeIso = new Date().toISOString();

    const resolvedManifest: ApprovedSessionManifest = manifest ?? {
      manifestVersion: 1,
      sessionId,
      tenantId,
      eventId,
      stationId: '30000000-0000-4000-8000-000000000001',
      operatorId: actorUserId,
      templateVersionId: '60000000-0000-4000-8000-000000000001',
      tokenHash: '0'.repeat(64),
      firstCapturedAt: new Date(Date.now() - 60000).toISOString(),
      approvedAt: serverTimeIso,
      expiresAt: new Date(Date.now() + 86400000 - 60000).toISOString(),
      assets: []
    };

    const finResult = await repo.finalizeSessionPublication({
      actorUserId,
      idempotencyKey,
      tenantId,
      eventId,
      sessionId,
      manifest: resolvedManifest,
      nowIso: serverTimeIso
    });

    if (finResult.status === 'published') {
      const responsePayload: FinalizeSessionResponse = {
        apiVersion: 'v1',
        sessionId,
        published: true,
        publishedAt: finResult.publishedAt ?? serverTimeIso,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        uploadState: 'published'
      };
      return NextResponse.json(responsePayload, { status: 200 });
    }

    if (finResult.status === 'rejected_incomplete') {
      return NextResponse.json(
        { error: 'REJECTED_INCOMPLETE', errorCode: finResult.errorCode },
        { status: 400 }
      );
    }

    if (finResult.status === 'rejected_expired') {
      return NextResponse.json(
        { error: 'REJECTED_EXPIRED', errorCode: finResult.errorCode },
        { status: 410 }
      );
    }

    if (finResult.status === 'unauthorized') {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', errorCode: finResult.errorCode },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'TRANSIENT_ERROR', errorCode: finResult.errorCode },
      { status: 500 }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'INTERNAL_SERVER_ERROR';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
