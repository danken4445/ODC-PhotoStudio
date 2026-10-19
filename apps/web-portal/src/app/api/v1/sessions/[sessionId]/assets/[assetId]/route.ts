import { NextResponse, type NextRequest } from 'next/server';
import { computeBufferSha256, computeScopedStoragePath } from '@odc-photostudio/contracts';
import { extractActorUserId } from '@/lib/api-auth';
import { getCloudPortalRepository } from '@/lib/supabase-repository';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; assetId: string }> }
): Promise<NextResponse> {
  try {
    const { sessionId, assetId } = await params;
    const actorUserId = await extractActorUserId(request);
    if (!actorUserId) {
      return NextResponse.json(
        { error: 'UNAUTHENTICATED', message: 'Bearer token or x-actor-user-id is required' },
        { status: 401 }
      );
    }

    const tenantId =
      request.headers.get('x-tenant-id') ||
      request.nextUrl.searchParams.get('tenantId') ||
      '';
    const eventId =
      request.headers.get('x-event-id') ||
      request.nextUrl.searchParams.get('eventId') ||
      '';

    const rawContentType = request.headers.get('content-type') || 'image/jpeg';
    const mimeType = rawContentType.includes('png') ? 'image/png' : 'image/jpeg';

    const arrayBuffer = await request.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const computedSha = computeBufferSha256(buffer);

    const providedSha =
      request.headers.get('x-asset-sha256') ||
      request.headers.get('x-sha256') ||
      request.nextUrl.searchParams.get('sha256') ||
      computedSha;

    if (providedSha.toLowerCase() !== computedSha.toLowerCase()) {
      return NextResponse.json(
        { error: 'CONFLICT_MISMATCH', errorCode: 'PAYLOAD_SHA256_MISMATCH' },
        { status: 409 }
      );
    }

    const storagePath =
      request.headers.get('x-storage-path') ||
      (tenantId && eventId
        ? computeScopedStoragePath({
            tenantId,
            eventId,
            sessionId,
            assetId,
            extension: mimeType === 'image/png' ? 'png' : 'jpg'
          })
        : '');

    const repo = getCloudPortalRepository();
    const uploadResult = await repo.uploadSessionAssetObject({
      actorUserId,
      tenantId,
      eventId,
      sessionId,
      assetId,
      storagePath,
      buffer,
      sha256: computedSha,
      mimeType,
      nowIso: new Date().toISOString()
    });

    if (uploadResult.status === 'ok') {
      return NextResponse.json(
        {
          apiVersion: 'v1',
          status: 'ok',
          sessionId,
          assetId,
          storagePath
        },
        { status: 200 }
      );
    }

    if (uploadResult.status === 'conflict_mismatch') {
      return NextResponse.json(
        { error: 'CONFLICT_MISMATCH', errorCode: uploadResult.errorCode },
        { status: 409 }
      );
    }

    if (uploadResult.status === 'unauthorized') {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', errorCode: uploadResult.errorCode },
        { status: 403 }
      );
    }

    if (uploadResult.status === 'expired') {
      return NextResponse.json(
        { error: 'SESSION_EXPIRED', errorCode: uploadResult.errorCode },
        { status: 410 }
      );
    }

    return NextResponse.json(
      { error: 'TRANSIENT_ERROR', errorCode: uploadResult.errorCode },
      { status: 500 }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'INTERNAL_SERVER_ERROR';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
