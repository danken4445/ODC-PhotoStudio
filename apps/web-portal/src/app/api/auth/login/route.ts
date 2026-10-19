import { NextResponse, type NextRequest } from 'next/server';
import { getPlatformService } from '@/lib/platform-service';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || body.username || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const platformService = getPlatformService();
    const userSession = await platformService.authenticateTenantUser(email, password);

    const token = `mock-token-${userSession.id}`;

    const res = NextResponse.json({
      ok: true,
      user: {
        id: userSession.id,
        email: userSession.email,
        displayName: userSession.displayName,
        role: userSession.role,
        mustChangePassword: userSession.mustChangePassword,
        tenant: userSession.tenant
      }
    });

    res.cookies.set('odc_tenant_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7 // 7 days
    });

    res.cookies.set('odc_active_tenant_id', userSession.tenant.id, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7
    });

    return res;
  } catch (err: any) {
    if (err.message === 'INVALID_CREDENTIALS') {
      return NextResponse.json(
        { error: 'Invalid studio login ID or password' },
        { status: 401 }
      );
    }
    if (err.message === 'TENANT_SUSPENDED') {
      return NextResponse.json(
        { error: 'This studio account is currently suspended. Please contact platform support.' },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: err.message || 'Internal server error during authentication' },
      { status: 500 }
    );
  }
}
