import { NextResponse, type NextRequest } from 'next/server';
import { getPlatformService } from '@/lib/platform-service';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token =
    req.cookies.get('odc_tenant_token')?.value ||
    req.headers.get('authorization')?.replace(/^bearer /i, '').trim();

  if (!token) {
    return NextResponse.json(
      { authenticated: false },
      { status: 401 }
    );
  }

  const platformService = getPlatformService();
  const session = await platformService.getTenantUserSession(token);

  if (!session) {
    return NextResponse.json(
      { authenticated: false },
      { status: 401 }
    );
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: session.id,
      email: session.email,
      displayName: session.displayName,
      role: session.role,
      mustChangePassword: session.mustChangePassword,
      tenant: session.tenant
    }
  });
}
