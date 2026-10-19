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

    if (session.role === 'operator') {
      return NextResponse.json(
        { error: 'FORBIDDEN: Only studio owners and admins can enroll stations' },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const label = String(body.label || 'Station Hardware').trim();

    const enrollment = await platformService.createStationEnrollment(
      {
        tenantId: session.tenant.id,
        label
      },
      session.id
    );

    return NextResponse.json({ ok: true, enrollment }, { status: 201 });
  } catch (err: any) {
    if (err.message === 'PLAN_LIMIT_EXCEEDED') {
      return NextResponse.json(
        { error: 'Maximum stations reached for your current plan tier.' },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: err.message || 'Failed to create station enrollment' },
      { status: 500 }
    );
  }
}
