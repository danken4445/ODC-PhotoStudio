import { NextResponse } from 'next/server';

export async function POST(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('odc_tenant_token');
  res.cookies.delete('odc_active_tenant_id');
  return res;
}
