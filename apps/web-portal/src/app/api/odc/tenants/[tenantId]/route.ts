import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin, AuthError } from '@/lib/api-auth';
import { getPlatformService } from '@/lib/platform-service';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ tenantId: string }> }
): Promise<NextResponse> {
  try {
    await requirePlatformAdmin(req);
    const { tenantId } = await context.params;
    const platformService = getPlatformService();
    const tenantDetails = await platformService.getTenantDetails(tenantId);
    return NextResponse.json(tenantDetails);
  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    if (err.message === 'TENANT_NOT_FOUND') {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
