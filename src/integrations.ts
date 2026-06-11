import crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "./db.js";
import { fail } from "./http.js";

export const webhookEvents = [
  "ATTENDANCE_PUNCH_IN",
  "ATTENDANCE_PUNCH_OUT",
  "LEAVE_DECIDED",
  "CORRECTION_DECIDED"
] as const;

export type WebhookEventName = (typeof webhookEvents)[number];

export type ApiKeyRecord = {
  id: string;
  name: string;
  keyHash: string;
  prefix: string;
  scopes: string[];
  active: boolean;
  createdById: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
};

export type WebhookEndpointRecord = {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: WebhookEventName[];
  active: boolean;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
};

type ApiKeyDelegate = {
  findMany(args: { orderBy: { createdAt: "asc" | "desc" } }): Promise<ApiKeyRecord[]>;
  findFirst(args: { where: { keyHash: string; active: boolean; revokedAt: null } }): Promise<ApiKeyRecord | null>;
  create(args: { data: { name: string; keyHash: string; prefix: string; scopes: string[]; createdById: string } }): Promise<ApiKeyRecord>;
  update(args: { where: { id: string }; data: Partial<ApiKeyRecord> }): Promise<ApiKeyRecord>;
};

type WebhookEndpointDelegate = {
  findMany(args: { where?: { active?: boolean; events?: { has: WebhookEventName } }; orderBy?: { createdAt: "asc" | "desc" } }): Promise<WebhookEndpointRecord[]>;
  create(args: { data: { name: string; url: string; secret: string; events: WebhookEventName[]; createdById: string } }): Promise<WebhookEndpointRecord>;
  update(args: { where: { id: string }; data: Partial<WebhookEndpointRecord> }): Promise<WebhookEndpointRecord>;
};

type WebhookDeliveryDelegate = {
  create(args: {
    data: {
      endpointId: string;
      event: WebhookEventName;
      payload: unknown;
      status: string;
      statusCode?: number;
      error?: string;
    };
  }): Promise<unknown>;
};

function apiKeys() {
  return (prisma as typeof prisma & { apiKey: ApiKeyDelegate }).apiKey;
}

function webhookEndpoints() {
  return (prisma as typeof prisma & { webhookEndpoint: WebhookEndpointDelegate }).webhookEndpoint;
}

function webhookDeliveries() {
  return (prisma as typeof prisma & { webhookDelivery: WebhookDeliveryDelegate }).webhookDelivery;
}

export const apiKeyScopes = ["attendance:read", "shifts:read", "leave:read"] as const;

export function hashApiKey(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createPlainApiKey() {
  return `difm_${crypto.randomBytes(24).toString("base64url")}`;
}

export function serializeApiKey(key: ApiKeyRecord, plainKey?: string) {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes,
    active: key.active,
    createdAt: key.createdAt.toISOString(),
    revokedAt: key.revokedAt?.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString(),
    key: plainKey
  };
}

export function serializeWebhook(endpoint: WebhookEndpointRecord) {
  return {
    id: endpoint.id,
    name: endpoint.name,
    url: endpoint.url,
    events: endpoint.events,
    active: endpoint.active,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString()
  };
}

export function listApiKeys() {
  return apiKeys().findMany({ orderBy: { createdAt: "desc" } });
}

export function createApiKey(input: { name: string; scopes: string[]; createdById: string }) {
  const plainKey = createPlainApiKey();
  const prefix = plainKey.slice(0, 12);
  return apiKeys()
    .create({
      data: {
        name: input.name,
        keyHash: hashApiKey(plainKey),
        prefix,
        scopes: input.scopes,
        createdById: input.createdById
      }
    })
    .then((record) => ({ record, plainKey }));
}

export function revokeApiKey(id: string) {
  return apiKeys().update({
    where: { id },
    data: { active: false, revokedAt: new Date() }
  });
}

export function listWebhooks() {
  return webhookEndpoints().findMany({ orderBy: { createdAt: "desc" } });
}

export function createWebhook(input: { name: string; url: string; events: WebhookEventName[]; createdById: string }) {
  return webhookEndpoints().create({
    data: {
      name: input.name,
      url: input.url,
      events: input.events,
      secret: crypto.randomBytes(24).toString("base64url"),
      createdById: input.createdById
    }
  });
}

export function setWebhookActive(id: string, active: boolean) {
  return webhookEndpoints().update({ where: { id }, data: { active } });
}

export type ApiAuthenticatedRequest = Request & {
  apiKey: ApiKeyRecord;
};

export function requireApiKey(scope: (typeof apiKeyScopes)[number]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const rawKey = req.header("x-api-key");
    if (!rawKey) {
      fail(res, 401, "API key required.");
      return;
    }
    const key = await apiKeys().findFirst({
      where: {
        keyHash: hashApiKey(rawKey),
        active: true,
        revokedAt: null
      }
    });
    if (!key || !key.scopes.includes(scope)) {
      fail(res, 403, "API key does not have access to this resource.");
      return;
    }
    await apiKeys().update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    (req as ApiAuthenticatedRequest).apiKey = key;
    next();
  };
}

export async function dispatchWebhook(event: WebhookEventName, payload: unknown) {
  const endpoints = await webhookEndpoints().findMany({
    where: { active: true, events: { has: event } }
  });
  await Promise.all(
    endpoints.map(async (endpoint) => {
      const body = JSON.stringify({ event, payload, sentAt: new Date().toISOString() });
      const signature = crypto.createHmac("sha256", endpoint.secret).update(body).digest("hex");
      try {
        const response = await fetch(endpoint.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-difm-event": event,
            "x-difm-signature": signature
          },
          body
        });
        await webhookDeliveries().create({
          data: {
            endpointId: endpoint.id,
            event,
            payload: JSON.parse(body),
            status: response.ok ? "DELIVERED" : "FAILED",
            statusCode: response.status,
            error: response.ok ? undefined : `HTTP ${response.status}`
          }
        });
      } catch (error) {
        await webhookDeliveries().create({
          data: {
            endpointId: endpoint.id,
            event,
            payload: JSON.parse(body),
            status: "FAILED",
            error: error instanceof Error ? error.message : "Webhook delivery failed."
          }
        });
      }
    })
  );
}

export const createApiKeySchema = z.object({
  name: z.string().min(2).max(80),
  scopes: z.array(z.enum(apiKeyScopes)).min(1)
});

export const createWebhookSchema = z.object({
  name: z.string().min(2).max(80),
  url: z.string().url(),
  events: z.array(z.enum(webhookEvents)).min(1)
});
