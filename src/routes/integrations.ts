import { Router } from "express";
import { AuthenticatedRequest, requireAuth, requireRoles } from "../auth/middleware.js";
import { audit } from "../audit.js";
import { asyncHandler } from "../asyncHandler.js";
import {
  createApiKey,
  createApiKeySchema,
  createWebhook,
  createWebhookSchema,
  listApiKeys,
  listWebhooks,
  revokeApiKey,
  serializeApiKey,
  serializeWebhook,
  setWebhookActive
} from "../integrations.js";
import { ok } from "../http.js";

const router = Router();

router.get(
  "/api-keys",
  requireAuth,
  requireRoles("ADMIN"),
  asyncHandler(async (_req, res) => {
    const keys = await listApiKeys();
    ok(res, keys.map((key) => serializeApiKey(key)));
  })
);

router.post(
  "/api-keys",
  requireAuth,
  requireRoles("ADMIN"),
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const input = createApiKeySchema.parse(req.body);
    const { record, plainKey } = await createApiKey({
      name: input.name,
      scopes: input.scopes,
      createdById: viewer.id
    });
    await audit({
      actorId: viewer.id,
      action: "integration.api_key_create",
      entityType: "ApiKey",
      entityId: record.id,
      metadata: { scopes: record.scopes },
      ipAddress: req.ip
    });
    ok(res, serializeApiKey(record, plainKey), 201);
  })
);

router.patch(
  "/api-keys/:id/revoke",
  requireAuth,
  requireRoles("ADMIN"),
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const key = await revokeApiKey(req.params.id);
    await audit({
      actorId: viewer.id,
      action: "integration.api_key_revoke",
      entityType: "ApiKey",
      entityId: key.id,
      ipAddress: req.ip
    });
    ok(res, serializeApiKey(key));
  })
);

router.get(
  "/webhooks",
  requireAuth,
  requireRoles("ADMIN"),
  asyncHandler(async (_req, res) => {
    const webhooks = await listWebhooks();
    ok(res, webhooks.map(serializeWebhook));
  })
);

router.post(
  "/webhooks",
  requireAuth,
  requireRoles("ADMIN"),
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const input = createWebhookSchema.parse(req.body);
    const webhook = await createWebhook({
      name: input.name,
      url: input.url,
      events: input.events,
      createdById: viewer.id
    });
    await audit({
      actorId: viewer.id,
      action: "integration.webhook_create",
      entityType: "WebhookEndpoint",
      entityId: webhook.id,
      metadata: { events: webhook.events },
      ipAddress: req.ip
    });
    ok(res, serializeWebhook(webhook), 201);
  })
);

router.patch(
  "/webhooks/:id/status",
  requireAuth,
  requireRoles("ADMIN"),
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const active = Boolean(req.body?.active);
    const webhook = await setWebhookActive(req.params.id, active);
    await audit({
      actorId: viewer.id,
      action: "integration.webhook_status",
      entityType: "WebhookEndpoint",
      entityId: webhook.id,
      metadata: { active },
      ipAddress: req.ip
    });
    ok(res, serializeWebhook(webhook));
  })
);

export { router as integrationsRouter };
