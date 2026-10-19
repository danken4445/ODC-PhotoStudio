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
        { error: 'FORBIDDEN: Only studio owners and admins can create events' },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    const timezone = String(body.timezone || 'UTC').trim();
    const startsAt = String(body.startsAt || '').trim();
    const endsAt = String(body.endsAt || '').trim();

    if (!name || !startsAt || !endsAt) {
      return NextResponse.json(
        { error: 'Event name, startsAt, and endsAt are required' },
        { status: 400 }
      );
    }

    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      return NextResponse.json(
        { error: 'Event end time must be after start time' },
        { status: 400 }
      );
    }

    const event = await platformService.createTenantEvent(session.tenant.id, {
      name,
      timezone,
      startsAt,
      endsAt
    });

    return NextResponse.json({ ok: true, event }, { status: 201 });
  } catch (err: any) {
    if (err.message === 'PLAN_LIMIT_EXCEEDED') {
      return NextResponse.json(
        { error: 'Your subscription plan event limit has been reached. Please upgrade to create more events.' },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: err.message || 'Failed to create event' },
      { status: 500 }
    );
  }
}
