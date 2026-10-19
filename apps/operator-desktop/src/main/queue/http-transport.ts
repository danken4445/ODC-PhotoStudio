import {
  redactTokensFromText,
  type ApprovedSessionManifest
} from '@odc-photostudio/contracts';
import type { CloudSyncTransport } from './sync-engine.js';

export interface HttpCloudSyncTransportOptions {
  baseUrl?: string;
  getBearerToken?: () => Promise<string | null> | string | null;
  timeoutMs?: number;
}

export class HttpCloudSyncTransport implements CloudSyncTransport {
  public readonly baseUrl: string;
  private readonly getBearerToken?: () => Promise<string | null> | string | null;
  private readonly timeoutMs: number;

  constructor(options: HttpCloudSyncTransportOptions = {}) {
    const rawUrl =
      options.baseUrl ||
      (typeof process !== 'undefined' && process.env?.ODC_PORTAL_API_URL) ||
      'http://localhost:3000';
    this.baseUrl = rawUrl.replace(/\/+$/, '');
    this.getBearerToken = options.getBearerToken;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private async resolveToken(): Promise<string | null> {
    if (this.getBearerToken) {
      try {
        const token = await this.getBearerToken();
        if (token) return token;
      } catch {
        // ignore token resolver error
      }
    }
    if (typeof process !== 'undefined' && process.env?.ODC_OPERATOR_BEARER_TOKEN) {
      return process.env.ODC_OPERATOR_BEARER_TOKEN;
    }
    return null;
  }

  private async buildHeaders(
    customHeaders: Record<string, string> = {}
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = { ...customHeaders };
    const token = await this.resolveToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  public async registerSession(params: {
    idempotencyKey: string;
    manifest: ApprovedSessionManifest;
  }): Promise<{
    status: 'ok' | 'unauthorized' | 'forbidden_revoked' | 'expired' | 'transient_error';
    alreadyUploadedAssetIds?: string[];
    errorCode?: string;
  }> {
    const url = `${this.baseUrl}/api/v1/sessions/register`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers = await this.buildHeaders({
        'Content-Type': 'application/json',
        'Idempotency-Key': params.idempotencyKey
      });

      const body = JSON.stringify({
        apiVersion: 'v1',
        idempotencyKey: params.idempotencyKey,
        manifest: params.manifest
      });

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal
      });

      let json: Record<string, unknown> | null = null;
      try {
        json = (await res.json()) as Record<string, unknown>;
      } catch {
        // non-JSON response
      }

      if (res.status === 200 || res.status === 201) {
        let uploadedIds: string[] = [];
        if (Array.isArray(json?.alreadyUploadedAssetIds)) {
          uploadedIds = json.alreadyUploadedAssetIds.map(String);
        } else if (Array.isArray(json?.objectTargets)) {
          uploadedIds = (json.objectTargets as Array<{ assetId?: string; alreadyUploaded?: boolean }>)
            .filter((t) => t.alreadyUploaded && t.assetId)
            .map((t) => String(t.assetId));
        }
        return {
          status: 'ok',
          alreadyUploadedAssetIds: uploadedIds
        };
      }

      if (res.status === 401) {
        return {
          status: 'unauthorized',
          errorCode: (json?.errorCode as string) || 'UNAUTHORIZED'
        };
      }

      if (res.status === 403) {
        return {
          status: 'forbidden_revoked',
          errorCode: (json?.errorCode as string) || 'FORBIDDEN_REVOKED'
        };
      }

      if (
        res.status === 410 ||
        json?.status === 'expired' ||
        json?.errorCode === 'SESSION_ALREADY_EXPIRED'
      ) {
        return {
          status: 'expired',
          errorCode: (json?.errorCode as string) || 'SESSION_EXPIRED'
        };
      }

      return {
        status: 'transient_error',
        errorCode: redactTokensFromText(
          (json?.errorCode as string) || (json?.error as string) || `HTTP_${res.status}`
        )
      };
    } catch (err) {
      return {
        status: 'transient_error',
        errorCode: redactTokensFromText(
          err instanceof Error ? err.message : 'TRANSIENT_FETCH_ERROR'
        )
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  public async uploadAssetObject(params: {
    tenantId: string;
    eventId: string;
    sessionId: string;
    assetId: string;
    storagePath: string;
    buffer: Buffer;
    sha256: string;
    mimeType: 'image/jpeg' | 'image/png';
  }): Promise<{
    status: 'ok' | 'conflict_mismatch' | 'unauthorized' | 'expired' | 'transient_error';
    errorCode?: string;
  }> {
    const url = `${this.baseUrl}/api/v1/sessions/${params.sessionId}/assets/${params.assetId}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers = await this.buildHeaders({
        'Content-Type': params.mimeType,
        'x-sha256': params.sha256,
        'x-tenant-id': params.tenantId,
        'x-event-id': params.eventId,
        'x-storage-path': params.storagePath
      });

      const res = await fetch(url, {
        method: 'PUT',
        headers,
        body: new Uint8Array(params.buffer),
        signal: controller.signal
      });

      let json: Record<string, unknown> | null = null;
      try {
        json = (await res.json()) as Record<string, unknown>;
      } catch {
        // non-JSON response
      }

      if (res.status >= 200 && res.status < 300) {
        return { status: 'ok' };
      }

      if (res.status === 409) {
        return {
          status: 'conflict_mismatch',
          errorCode: (json?.errorCode as string) || 'CONFLICT_MISMATCH'
        };
      }

      if (res.status === 401 || res.status === 403) {
        return {
          status: 'unauthorized',
          errorCode: (json?.errorCode as string) || 'UNAUTHORIZED'
        };
      }

      if (res.status === 410) {
        return {
          status: 'expired',
          errorCode: (json?.errorCode as string) || 'SESSION_EXPIRED'
        };
      }

      return {
        status: 'transient_error',
        errorCode: redactTokensFromText(
          (json?.errorCode as string) || (json?.error as string) || `HTTP_${res.status}`
        )
      };
    } catch (err) {
      return {
        status: 'transient_error',
        errorCode: redactTokensFromText(
          err instanceof Error ? err.message : 'TRANSIENT_UPLOAD_ERROR'
        )
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  public async finalizeSession(params: {
    idempotencyKey: string;
    tenantId: string;
    eventId: string;
    sessionId: string;
    manifest: ApprovedSessionManifest;
  }): Promise<{
    status: 'published' | 'rejected_incomplete' | 'rejected_expired' | 'unauthorized' | 'transient_error';
    publishedAt?: string;
    errorCode?: string;
  }> {
    const url = `${this.baseUrl}/api/v1/sessions/${params.sessionId}/finalize`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers = await this.buildHeaders({
        'Content-Type': 'application/json',
        'Idempotency-Key': params.idempotencyKey
      });

      const body = JSON.stringify({
        apiVersion: 'v1',
        idempotencyKey: params.idempotencyKey,
        tenantId: params.tenantId,
        eventId: params.eventId,
        sessionId: params.sessionId,
        manifestVersion: params.manifest.manifestVersion,
        manifest: params.manifest
      });

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal
      });

      let json: Record<string, unknown> | null = null;
      try {
        json = (await res.json()) as Record<string, unknown>;
      } catch {
        // non-JSON response
      }

      if (res.status >= 200 && res.status < 300) {
        return {
          status: 'published',
          publishedAt:
            (json?.publishedAt as string) || (json?.published_at as string) || new Date().toISOString()
        };
      }

      if (res.status === 400) {
        const errCode = ((json?.errorCode as string) || '').toUpperCase();
        if (errCode.includes('INCOMPLETE') || json?.status === 'rejected_incomplete') {
          return {
            status: 'rejected_incomplete',
            errorCode: (json?.errorCode as string) || 'REJECTED_INCOMPLETE'
          };
        }
        if (errCode.includes('EXPIRED') || json?.status === 'rejected_expired') {
          return {
            status: 'rejected_expired',
            errorCode: (json?.errorCode as string) || 'REJECTED_EXPIRED'
          };
        }
        return {
          status: 'transient_error',
          errorCode: (json?.errorCode as string) || 'BAD_REQUEST'
        };
      }

      if (res.status === 401) {
        return {
          status: 'unauthorized',
          errorCode: (json?.errorCode as string) || 'UNAUTHORIZED'
        };
      }

      if (res.status === 403) {
        return {
          status: 'unauthorized',
          errorCode: (json?.errorCode as string) || 'FORBIDDEN'
        };
      }

      if (res.status === 410) {
        return {
          status: 'rejected_expired',
          errorCode: (json?.errorCode as string) || 'SESSION_EXPIRED'
        };
      }

      return {
        status: 'transient_error',
        errorCode: redactTokensFromText(
          (json?.errorCode as string) || (json?.error as string) || `HTTP_${res.status}`
        )
      };
    } catch (err) {
      return {
        status: 'transient_error',
        errorCode: redactTokensFromText(
          err instanceof Error ? err.message : 'TRANSIENT_FINALIZE_ERROR'
        )
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
