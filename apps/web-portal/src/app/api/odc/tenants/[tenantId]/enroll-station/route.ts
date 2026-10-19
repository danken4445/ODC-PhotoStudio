import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin, AuthError } from '@/lib/api-auth';
import { getPlatformService } from '@/lib/platform-service';
import { EnrollStationInputSchema } from '@odc-photostudio/contracts';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ tenantId: string }> }
) {
  try {
    const adminUserId = await requirePlatformAdmin(req);
    const { tenantId } = await context.params;
    const body = await req.json().catch(() => ({}));

    const parseResult = EnrollStationInputSchema.safeParse({
      ...body,
      tenantId
    });

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const platformService = getPlatformService();
    const result = await platformService.createStationEnrollment(parseResult.data, adminUserId);

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    if (err.message && err.message.includes('PLAN_LIMIT_EXCEEDED')) {
      return NextResponse.json({ error: 'PLAN_LIMIT_EXCEEDED', message: err.message }, { status: 403 });
    }
    if (err.message === 'TENANT_NOT_FOUND') {
      return NextResponse.json({ error: 'TENANT_NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
