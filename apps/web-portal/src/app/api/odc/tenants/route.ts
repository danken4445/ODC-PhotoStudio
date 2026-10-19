import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin, AuthError } from '@/lib/api-auth';
import { getPlatformService } from '@/lib/platform-service';
import { OnboardTenantInputSchema } from '@odc-photostudio/contracts';

export async function GET(req: NextRequest) {
  try {
    await requirePlatformAdmin(req);
    const platformService = getPlatformService();
    const tenants = await platformService.listTenants();
    return NextResponse.json({ tenants });
  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const adminUserId = await requirePlatformAdmin(req);
    const body = await req.json();

    const parseResult = OnboardTenantInputSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const platformService = getPlatformService();
    const result = await platformService.onboardTenant(parseResult.data, adminUserId);

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    if (err.message === 'SLUG_ALREADY_EXISTS') {
      return NextResponse.json({ error: 'SLUG_ALREADY_EXISTS' }, { status: 409 });
    }
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
