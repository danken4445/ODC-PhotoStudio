import { NextRequest, NextResponse } from 'next/server';
import { getPlatformService } from '@/lib/platform-service';
import {
  RedeemEnrollmentCodeInputSchema,
  ENROLLMENT_CODE_INVALID,
  ENROLLMENT_CODE_EXPIRED,
  ENROLLMENT_CODE_USED
} from '@odc-photostudio/contracts';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parseResult = RedeemEnrollmentCodeInputSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const platformService = getPlatformService();
    const result = await platformService.redeemStationEnrollment(parseResult.data);

    return NextResponse.json(result);
  } catch (err: any) {
    if (err.message === ENROLLMENT_CODE_INVALID) {
      return NextResponse.json({ error: ENROLLMENT_CODE_INVALID }, { status: 404 });
    }
    if (err.message === ENROLLMENT_CODE_USED) {
      return NextResponse.json({ error: ENROLLMENT_CODE_USED }, { status: 409 });
    }
    if (err.message === ENROLLMENT_CODE_EXPIRED) {
      return NextResponse.json({ error: ENROLLMENT_CODE_EXPIRED }, { status: 410 });
    }
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
