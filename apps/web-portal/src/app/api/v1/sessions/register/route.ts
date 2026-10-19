import { NextResponse, type NextRequest } from 'next/server';
import {
  computeScopedStoragePath,
  RegisterSessionRequestSchema,
  type RegisterSessionResponse
} from '@odc-photostudio/contracts';
import { extractActorUserId } from '@/lib/api-auth';
import { getCloudPortalRepository } from '@/lib/supabase-repository';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const parsed = RegisterSessionRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'INVALID_REQUEST', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { idempotencyKey, manifest } = parsed.data;
    const actorUserId =
      (await extractActorUserId(request)) || manifest.operatorId;

    if (!actorUserId) {
      return NextResponse.json(
        { error: 'UNAUTHENTICATED', message: 'Bearer token or x-actor-user-id is required' },
        { status: 401 }
      );
    }

    const repo = getCloudPortalRepository();
    const serverTimeIso = new Date().toISOString();

    const regResult = await repo.registerSession({
      actorUserId,
      idempotencyKey,
      manifest,
      nowIso: serverTimeIso
    });

    if (regResult.status === 'unauthorized') {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', errorCode: regResult.errorCode },
        { status: 401 }
      );
    }

    if (regResult.status === 'forbidden_revoked') {
      return NextResponse.json(
        { error: 'FORBIDDEN', errorCode: regResult.errorCode },
        { status: 403 }
      );
    }

    if (regResult.status === 'expired') {
      return NextResponse.json(
        { error: 'SESSION_EXPIRED', errorCode: regResult.errorCode },
        { status: 410 }
      );
    }

    const alreadyUploadedSet = new Set(regResult.alreadyUploadedAssetIds ?? []);

    const responsePayload: RegisterSessionResponse = {
      apiVersion: 'v1',
      sessionId: manifest.sessionId,
      uploadState: 'registering',
      serverTimeIso,
      objectTargets: manifest.assets.map((asset) => ({
        assetId: asset.assetId,
        storagePath: computeScopedStoragePath({
          tenantId: manifest.tenantId,
          eventId: manifest.eventId,
          sessionId: manifest.sessionId,
          assetId: asset.assetId,
          extension: asset.mimeType === 'image/png' ? 'png' : 'jpg'
        }),
        alreadyUploaded: alreadyUploadedSet.has(asset.assetId)
      }))
    };

    return NextResponse.json(responsePayload, { status: 200 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'INTERNAL_SERVER_ERROR';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
