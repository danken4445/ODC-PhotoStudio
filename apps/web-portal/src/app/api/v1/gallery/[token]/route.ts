import { NextResponse, type NextRequest } from 'next/server';
import { getCloudPortalRepository } from '@/lib/supabase-repository';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  try {
    const { token } = await params;
    const elapsedParam = request.nextUrl.searchParams.get('elapsed');
    const elapsedPollingSeconds = elapsedParam ? parseInt(elapsedParam, 10) : 0;

    const repo = getCloudPortalRepository();
    const lookup = await repo.lookupGalleryByToken({
      rawToken: token,
      nowIso: new Date().toISOString(),
      elapsedPollingSeconds
    });

    return NextResponse.json(lookup, { status: 200 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'GALLERY_UNAVAILABLE';
    return NextResponse.json(
      {
        apiVersion: 'v1',
        state: 'unknown_unavailable',
        customerNotice: 'This gallery link is unavailable.',
        assets: []
      },
      { status: 200 }
    );
  }
}
