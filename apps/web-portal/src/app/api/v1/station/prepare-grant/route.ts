import { NextResponse, type NextRequest } from 'next/server';
import {
  PrepareEventRequestSchema,
  type PrepareEventResponse,
  type PrintProfile
} from '@odc-photostudio/contracts';
import { extractActorUserId } from '@/lib/api-auth';
import { getCloudPortalRepository } from '@/lib/supabase-repository';
import { createDefaultFourBySixPostcardTemplate } from '@odc-photostudio/template-engine';

const DEFAULT_PRINT_PROFILES: PrintProfile[] = [
  {
    id: 'prof-4x6-standard',
    name: '4x6 Postcard Standard',
    deviceName: 'DNP-DS620A',
    paperSize: '4x6_postcard',
    dpi: 300,
    scalingMode: 'exact_1_to_1',
    offsetXMm: 0,
    offsetYMm: 0,
    maxCopiesPerSession: 3,
    supportsTwoBySixCut: false,
    stripImposition: 'none'
  }
];

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const parsed = PrepareEventRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'INVALID_REQUEST', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { tenantId, eventId, stationId } = parsed.data;
    const actorUserId = await extractActorUserId(request);
    if (!actorUserId) {
      return NextResponse.json(
        { error: 'UNAUTHENTICATED', message: 'Bearer token or x-actor-user-id is required' },
        { status: 401 }
      );
    }

    const repo = getCloudPortalRepository();
    const serverTimeIso = new Date().toISOString();

    const offlineGrant = await repo.issueOfflineEventGrant({
      actorUserId,
      tenantId,
      eventId,
      stationId,
      permittedPrintProfiles: DEFAULT_PRINT_PROFILES,
      nowIso: serverTimeIso
    });

    // Provide default template definition if none in database
    const defaultTemplateDef = createDefaultFourBySixPostcardTemplate({
      overlayAssetId: 'overlay-default',
      overlaySha256: '0'.repeat(64)
    });

    const templateIds: string[] =
      offlineGrant.payload.permittedTemplateVersionIds.length > 0
        ? offlineGrant.payload.permittedTemplateVersionIds
        : ['60000000-0000-4000-8000-000000000001'];

    const responsePayload: PrepareEventResponse = {
      apiVersion: 'v1',
      serverTimeIso,
      event: {
        id: eventId,
        tenantId,
        name: 'Active PhotoStudio Event',
        timezone: 'UTC',
        startsAt: new Date(Date.now() - 3600000).toISOString(),
        endsAt: new Date(Date.now() + 86400000 * 2).toISOString(),
        status: 'active'
      },
      templates: templateIds.map((verId: string) => ({
        templateVersionId: verId,
        templateId: '70000000-0000-4000-8000-000000000001',
        name: '4x6 Studio Postcard',
        version: 1,
        definition: defaultTemplateDef,
        overlayDownloadUrl: `https://storage.odc-photostudio.internal/overlays/${verId}.png`
      })),
      printProfiles: DEFAULT_PRINT_PROFILES,
      offlineGrant
    };

    return NextResponse.json(responsePayload, { status: 200 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'INTERNAL_SERVER_ERROR';
    const status = msg.includes('FORBIDDEN') || msg.includes('INSUFFICIENT') ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
