import { NextResponse, type NextRequest } from 'next/server';
import { getCloudPortalRepository } from '@/lib/supabase-repository';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  try {
    const { token } = await params;
    const assetId = request.nextUrl.searchParams.get('assetId');

    if (!assetId) {
      return NextResponse.json(
        { error: 'BAD_REQUEST', message: 'Missing required query parameter assetId' },
        { status: 400 }
      );
    }

    const repo = getCloudPortalRepository();
    const authResult = await repo.authorizeGuestAssetDownload({
      rawToken: token,
      assetId,
      nowIso: new Date().toISOString()
    });

    if (!authResult.authorized || !authResult.signedDownloadUrl) {
      const status = authResult.reason?.includes('EXPIRED') ? 410 : 403;
      return NextResponse.json(
        { error: 'DOWNLOAD_DENIED', reason: authResult.reason ?? 'NOT_AUTHORIZED' },
        { status }
      );
    }

    // Redirect to signed storage URL with temporary redirect
    return NextResponse.redirect(authResult.signedDownloadUrl, 307);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'DOWNLOAD_ERROR';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
