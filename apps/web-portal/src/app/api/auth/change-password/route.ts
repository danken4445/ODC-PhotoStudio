import { NextResponse, type NextRequest } from 'next/server';
import { getPlatformService } from '@/lib/platform-service';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const token =
      req.cookies.get('odc_tenant_token')?.value ||
      req.headers.get('authorization')?.replace(/^bearer /i, '').trim();

    if (!token) {
      return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const platformService = getPlatformService();
    const session = await platformService.getTenantUserSession(token);

    if (!session) {
      return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const newPassword = String(body.newPassword || '').trim();

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters long' },
        { status: 400 }
      );
    }

    await platformService.changeTenantUserPassword(session.id, newPassword);

    return NextResponse.json({ ok: true, message: 'Password updated successfully' });
  } catch (err: any) {
    console.error('[API change-password] Error changing password:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to update password' },
      { status: 500 }
    );
  }
}
