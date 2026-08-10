import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(
  testDirectory,
  "../skills/phd-atlas/scripts/phd-atlas-cli.mjs",
);
const serverAuthorizationPath = path.resolve(
  testDirectory,
  '../../../../../server/codexAuthorization.js',
);
const transferRootByConfigDirectory = new Map();
const mcpInitializeParams = Object.freeze({
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "claude-desktop", version: "1.0.0" },
});

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function mockDeviceCode(index) {
  return Buffer.alloc(32, index % 256).toString("base64url");
}

function mockUserCode(index) {
  return "ABCD-" + String(index).padStart(4, "0");
}

function mockAccessToken(index) {
  const selector = Buffer.alloc(12, index % 256).toString("base64url");
  const secret = Buffer.alloc(32, (index + 16) % 256).toString("base64url");
  return "phda_cdx_v1_" + selector + "_" + secret;
}

const mockFullGrantedScopes = Object.freeze([
  "applications:read",
  "applications:write",
  "files:read",
  "files:write",
  "communications:read",
  "communications:send",
  "profile:read",
  "profile:write",
  "shares:manage",
  "discover:write",
  "mail:manage",
  "ai:manage",
  "ai:use",
  "interview:read",
  "interview:write",
  "interview:use",
]);

function mockGrantedScopes(state) {
  return (state.grantedScopesOverride ?? mockFullGrantedScopes).filter(
    (scope) =>
      !(state.omitFilesReadFromCapabilities && scope === "files:read") &&
      !(state.omitFilesWriteFromCapabilities && scope === "files:write"),
  );
}

function mockCredential(state, index) {
  const deviceMode = state.deviceModes.get(index);
  const issuedAt = state.deviceIssuedAt.get(index);
  const overlongExpiry =
    deviceMode === "expiry_overgrant" && issuedAt
      ? new Date(Date.parse(issuedAt) + 365 * 24 * 60 * 60 * 1_000).toISOString()
      : null;
  return {
    id: "credential-" + index,
    name: "Codex " + index,
    grantedScopes:
      deviceMode === "scope_overgrant"
        ? ["applications:read", "applications:write"]
        : mockGrantedScopes(state),
    createdAt: overlongExpiry ? issuedAt : "2026-08-02T00:00:00.000Z",
    lastUsedAt: overlongExpiry ? issuedAt : "2026-08-02T00:00:00.000Z",
    expiresAt: overlongExpiry || "2027-08-02T00:00:00.000Z",
  };
}

async function syncStoredMockScopes(configDirectory, accountId, state) {
  const configPath = path.join(configDirectory, "config.json");
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  assert.ok(config.accounts[accountId]);
  config.accounts[accountId].grantedScopes = mockGrantedScopes(state);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
}

async function discardMockPendingLogin(configDirectory, loginId) {
  const configPath = path.join(configDirectory, "config.json");
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  delete config.pendingLogins[loginId];
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
}

function readRequest(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": body.length,
  });
  response.end(body);
}

function mockCanonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "null";
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return "[" + value.map((entry) => mockCanonicalJson(entry)).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return (
    "{" +
    keys
      .map((key) => JSON.stringify(key) + ":" + mockCanonicalJson(value[key]))
      .join(",") +
    "}"
  );
}

function mockCanonicalDigest(value) {
  return createHash("sha256").update(mockCanonicalJson(value)).digest("base64url");
}

const mockApplicationAuthorityFields = new Set([
  "ownerId",
  "teamId",
  "teamTransferRequest",
  "shares",
  "reviewComments",
  "backupSettings",
  "versions",
  "deletedAt",
  "createdAt",
  "updatedAt",
  "ownerName",
  "ownerEmail",
  "currentUserApplicationRole",
  "clientBaseApplication",
]);
const mockVaultAuthorityFields = new Set([
  "fileId",
  "fileName",
  "fileSize",
  "mimeType",
  "storageName",
  "versions",
]);
const mockCommunicationAuthorityFields = new Set([
  "attachments",
  "deliveryStatus",
  "scheduledAt",
  "sentAt",
  "deliveryId",
  "deliveryUserId",
  "deliveryStartedAt",
  "nextDeliveryAttemptAt",
  "deliveryAttemptCount",
  "deliveryLastErrorCode",
  "deliveryLastErrorAt",
  "sourceMessageKey",
  "sourceMailbox",
  "importedAt",
  "mailSecurity",
  "bodyFormat",
  "bodyHtml",
  "bodyText",
  "mailClassification",
]);

function mockApplicationProjection(value, pathSegments = []) {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      mockApplicationProjection(entry, [...pathSegments, index]),
    );
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => {
        if (pathSegments.length === 0) {
          return !mockApplicationAuthorityFields.has(key);
        }
        if (pathSegments.length === 1 && pathSegments[0] === "school") {
          return key !== "logo";
        }
        if (
          pathSegments.length === 2 &&
          ["materials", "tasks"].includes(pathSegments[0])
        ) {
          return !mockVaultAuthorityFields.has(key);
        }
        if (
          pathSegments.length === 2 &&
          pathSegments[0] === "communications"
        ) {
          return !mockCommunicationAuthorityFields.has(key);
        }
        return true;
      })
      .map(([key, entry]) => [
        key,
        mockApplicationProjection(entry, [...pathSegments, key]),
      ]),
  );
}

function mockApplicationAuthoredDigest(application) {
  return mockCanonicalDigest({
    application: mockApplicationProjection(application),
    projectionVersion: 2,
  });
}

function mockCreateBaseline(input) {
  const text = (value) => (typeof value === "string" ? value : "");
  const notes = text(input.notes);
  const deadline = text(input.deadline);
  return {
    professor: {
      english: text(input.professor),
      chinese: text(input.professorChinese),
      email: text(input.professorEmail),
      homepage: text(input.professorHomepage),
      research: notes || "Research fit notes to be added.",
    },
    school: {
      name: text(input.university),
      country: text(input.country),
      website: text(input.website),
    },
    program: text(input.program),
    deadline,
    nextReminder: deadline,
    result: notes || "Draft created.",
    timeline: [
      { note: notes || "Application workspace initialized." },
    ],
  };
}

function mockCreateAcknowledgement(input, application, options = {}) {
  const authorityReceipt = {
    createdAt: application.createdAt,
    id: application.id,
    ownerId: application.ownerId,
    teamId: application.teamId,
    teamTransferRequest: application.teamTransferRequest ?? null,
  };
  const acknowledgement = {
    protocol: "phd-atlas-application-mutation-ack-v2",
    projectionVersion: 2,
    id: application.id,
    baseUpdatedAt: null,
    updatedAt: application.updatedAt,
    operationCount: 0,
    mutationHash: mockCanonicalDigest(input),
    baselineHash: mockApplicationAuthoredDigest(mockCreateBaseline(input)),
    applicationHash: mockApplicationAuthoredDigest(application),
    authorityPurpose: "create",
    authorityProjectionVersion: 1,
    authorityHash:
      options.authorityHash || mockCanonicalDigest(authorityReceipt),
    patch: [],
  };
  acknowledgement.canonicalHash = mockCanonicalDigest({
    protocol: acknowledgement.protocol,
    projectionVersion: acknowledgement.projectionVersion,
    id: acknowledgement.id,
    baseUpdatedAt: acknowledgement.baseUpdatedAt,
    updatedAt: acknowledgement.updatedAt,
    operationCount: acknowledgement.operationCount,
    mutationHash: acknowledgement.mutationHash,
    baselineHash: acknowledgement.baselineHash,
    applicationHash: acknowledgement.applicationHash,
    authorityPurpose: acknowledgement.authorityPurpose,
    authorityProjectionVersion: acknowledgement.authorityProjectionVersion,
    authorityHash: acknowledgement.authorityHash,
    patch: acknowledgement.patch,
  });
  return { ...acknowledgement, durable: true };
}

const existingAttachmentConditionalScope = {
  source: "json-body",
  path: ["attachments", "*", "fileId"],
  operator: "non-empty-string",
  requiredScopes: ["files:read"],
};

function capabilityRoute(prefix, methods, requiredScopes, conditionalRequiredScopes = []) {
  return { prefix, methods, requiredScopes, conditionalRequiredScopes };
}

function createMockServer() {
  const state = {
    origin: null,
    verificationBase: null,
    starts: 0,
    devices: new Map(),
    deviceModes: new Map(),
    deviceIssuedAt: new Map(),
    nextDeviceMode: null,
    nextDeviceCodeOverride: null,
    exchangeCalls: new Map(),
    whoamiFailures: new Map(),
    revoked: new Set(),
    revokeCalls: 0,
    failNextRevoke: false,
    capabilityMode: "valid",
    deniedPrefixes: ["/api/admin"],
    shareCreates: 0,
    aiKeyCreates: 0,
    uploadBytes: 0,
    uploadRequests: 0,
    lastUploadBody: null,
    nextUploadRequestGate: null,
    omitFilesReadFromCapabilities: false,
    omitFilesWriteFromCapabilities: false,
    grantedScopesOverride: null,
    communicationSendCalls: 0,
    communicationClassificationRequests: [],
    communicationCategoryRequests: [],
    settingsVersion: 0,
    settings: { language: "en", highContrast: false },
    settingsAcknowledgementRequests: [],
    malformedNextSettingsAcknowledgement: false,
    applicationPuts: [],
    applicationCreatePosts: [],
    createdApplicationReads: [],
    createdApplications: new Map(),
    application: {
      id: "app-1",
      ownerId: "user-1",
      teamId: null,
      program: "Computer Science PhD",
      deadline: "2026-11-30",
      deadlineTime: "17:00",
      notes: {
        draft: "original",
        serverOwnedMarker: "preserve-me",
      },
      materials: [{ id: "material-1", name: "Statement" }],
      tasks: [{ id: "task-1", title: "Ask recommender" }],
      timeline: [{ id: "event-1", label: "Submit" }],
      communications: [
        { id: "communication-1", subject: "Welcome", status: "received" },
      ],
    },
  };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, state.origin);
    if (
      request.method === "POST" &&
      url.pathname === "/api/codex/device-authorizations"
    ) {
      const body = JSON.parse((await readRequest(request)).toString("utf8"));
      assert.equal(body.scope_version, 2);
      assert.ok(
        ["PhD Atlas CLI", "Claude Desktop"].includes(body.client_name),
        `unexpected client name: ${body.client_name}`,
      );
      assert.ok(body.scopes.includes("applications:read"));
      state.starts += 1;
      const index = state.starts;
      const deviceCode = state.nextDeviceCodeOverride || mockDeviceCode(index);
      state.nextDeviceCodeOverride = null;
      const userCode = mockUserCode(index);
      state.devices.set(deviceCode, index);
      state.deviceModes.set(index, state.nextDeviceMode);
      state.deviceIssuedAt.set(index, new Date().toISOString());
      state.nextDeviceMode = null;
      const verificationBase = state.verificationBase || state.origin;
      sendJson(response, 200, {
        ok: true,
        data: {
          device_code: deviceCode,
          user_code: userCode,
          verification_uri: verificationBase + "/settings/codex",
          verification_uri_complete:
            verificationBase + "/settings/codex?user_code=" + userCode,
          expires_in: 600,
          interval: 1,
        },
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/codex/device-authorizations/token"
    ) {
      const body = JSON.parse((await readRequest(request)).toString("utf8"));
      assert.equal(
        body.grant_type,
        "urn:ietf:params:oauth:grant-type:device_code",
      );
      const index = state.devices.get(body.device_code);
      if (!index) {
        sendJson(response, 400, {
          ok: false,
          error: { code: "AUTHORIZATION_EXPIRED", message: "Unknown code" },
        });
        return;
      }
      const calls = (state.exchangeCalls.get(index) || 0) + 1;
      state.exchangeCalls.set(index, calls);
      const deviceMode = state.deviceModes.get(index);
      if (deviceMode === "slow_down") {
        response.setHeader("retry-after", "9");
        sendJson(response, 400, {
          error: "slow_down",
          error_description: "Poll more slowly",
          interval: 9,
        });
        return;
      }
      if (deviceMode === "denied") {
        sendJson(response, 400, {
          error: "access_denied",
          error_description: "Denied",
        });
        return;
      }
      if (deviceMode === "expired") {
        sendJson(response, 400, {
          error: "expired_token",
          error_description: "Expired",
        });
        return;
      }
      if (deviceMode === "wait_for_cancel") {
        const timer = setTimeout(() => {
          if (!response.destroyed) {
            sendJson(response, 400, {
              error: "authorization_pending",
              error_description: "Approval is pending",
              interval: 5,
            });
          }
        }, 10_000);
        timer.unref();
        response.on("close", () => clearTimeout(timer));
        return;
      }
      if (index === 1 && calls === 1) {
        response.setHeader("retry-after", "5");
        sendJson(response, 400, {
          error: "authorization_pending",
          error_description: "Approval is pending",
          interval: 5,
        });
        return;
      }
      const token =
        deviceMode === "malformed_token"
          ? "not-a-phd-atlas-token"
          : deviceMode === "oversized_token"
            ? "phda_cdx_v1_" + "A".repeat(900)
            : mockAccessToken(index);
      sendJson(response, 200, {
        ok: true,
        data: {
          access_token: token,
          token_type: "Bearer",
          credential: mockCredential(state, index),
          user: {
            id: "user-" + index,
            email: "user" + index + "@example.test",
            name: "User " + index,
          },
        },
      });
      return;
    }

    const authorization = request.headers.authorization || "";
    const accountIndex =
      Array.from({ length: 32 }, (_, index) => index + 1).find(
        (index) => authorization === "Bearer " + mockAccessToken(index),
      ) || null;
    if (!accountIndex || state.revoked.has(accountIndex)) {
      sendJson(response, 401, {
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Authorization is invalid" },
      });
      return;
    }
    const credential = mockCredential(state, accountIndex);
    if (request.method === "GET" && url.pathname === "/api/codex/whoami") {
      const whoamiFailures = state.whoamiFailures.get(accountIndex) || 0;
      if (whoamiFailures > 0) {
        state.whoamiFailures.set(accountIndex, whoamiFailures - 1);
        sendJson(response, 503, {
          ok: false,
          error: {
            code: "TEMPORARY_FAILURE",
            message: "Identity verification is temporarily unavailable",
          },
        });
        return;
      }
      sendJson(response, 200, {
        ok: true,
        data: {
          credential,
          user: {
            id: "user-" + accountIndex,
            email: "user" + accountIndex + "@example.test",
            name: "User " + accountIndex,
          },
        },
      });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/codex/capabilities"
    ) {
      if (state.capabilityMode === "reauth") {
        sendJson(response, 401, {
          ok: false,
          error: {
            code: "CODEX_AUTHORIZATION_REAUTHORIZATION_REQUIRED",
            message: "Scope policy changed; create a new authorization.",
          },
        });
        return;
      }
      if (state.capabilityMode === "malformed") {
        sendJson(response, 200, {
          ok: true,
          data: { schemaVersion: 2, scopeVersion: 2, routePrefixes: "all" },
        });
        return;
      }
      if (state.capabilityMode === "unsupported") {
        sendJson(response, 200, {
          ok: true,
          data: {
            schemaVersion: 1,
            scopeVersion: 2,
            credential,
            routePrefixes: [],
            deniedPrefixes: [],
          },
        });
        return;
      }
      if (state.capabilityMode === "malformed-condition") {
        sendJson(response, 200, {
          ok: true,
          data: {
            schemaVersion: 2,
            scopeVersion: 2,
            credential,
            routePrefixes: [capabilityRoute(
              "/api/applications/:applicationId/communications/send",
              ["POST"],
              ["applications:read", "communications:send"],
              [{
                ...existingAttachmentConditionalScope,
                operator: "unknown",
              }],
            )],
            deniedPrefixes: [],
          },
        });
        return;
      }
      if (state.capabilityMode === "noncanonical-denied-prefix") {
        sendJson(response, 200, {
          ok: true,
          data: {
            schemaVersion: 2,
            scopeVersion: 2,
            credential,
            routePrefixes: [capabilityRoute(
              "/api/applications",
              ["GET"],
              ["applications:read"],
            )],
            deniedPrefixes: ["/api//admin"],
          },
        });
        return;
      }
      if (
        state.capabilityMode === "duplicate-condition" ||
        state.capabilityMode === "overlapping-condition" ||
        state.capabilityMode === "noncanonical-prefix"
      ) {
        const exactSend = capabilityRoute(
          "/api/applications/:applicationId/communications/send",
          ["POST"],
          ["applications:read", "communications:send"],
          [existingAttachmentConditionalScope],
        );
        const shadowPrefix = state.capabilityMode === "duplicate-condition"
          ? exactSend.prefix
          : state.capabilityMode === "overlapping-condition"
            ? "/api/applications/:applicationIdentifier/communications/:operationIdentifier"
            : "/api/applications//:applicationId/communications/send";
        sendJson(response, 200, {
          ok: true,
          data: {
            schemaVersion: 2,
            scopeVersion: 2,
            credential,
            routePrefixes: [
              capabilityRoute(
                shadowPrefix,
                ["POST"],
                ["applications:read", "communications:send"],
              ),
              exactSend,
            ],
            deniedPrefixes: [],
          },
        });
        return;
      }
      const grantedScopes = new Set(credential.grantedScopes);
      const routePrefixes = [
        capabilityRoute(
          "/api/applications/:applicationId/communications/send",
          ["POST"],
          ["applications:read", "communications:send"],
          [existingAttachmentConditionalScope],
        ),
        capabilityRoute(
          "/api/applications/:applicationId/communications/classify",
          ["POST"],
          ["applications:write", "communications:read", "ai:use"],
        ),
        capabilityRoute(
          "/api/applications/:applicationId/communications/categories",
          ["PATCH"],
          ["applications:write", "communications:read"],
        ),
        capabilityRoute("/api/applications", ["GET"], ["applications:read"]),
        capabilityRoute(
          "/api/applications",
          ["POST", "PUT", "PATCH", "DELETE"],
          ["applications:write"],
        ),
        capabilityRoute(
          "/api/codex/profile-recommenders",
          ["GET", "POST", "PATCH", "DELETE"],
          ["profile:read", "profile:write"],
        ),
        capabilityRoute(
          "/api/applications/:applicationId/share",
          ["POST", "PATCH", "DELETE"],
          ["applications:write", "shares:manage"],
        ),
        capabilityRoute("/api/settings", ["POST", "PATCH"], ["mail:manage"]),
        capabilityRoute(
          "/api/discover/programs",
          ["POST", "PATCH", "DELETE"],
          ["discover:write"],
        ),
        capabilityRoute(
          "/api/ai/keys",
          ["POST", "PATCH", "DELETE"],
          ["ai:manage"],
        ),
        capabilityRoute(
          "/api/interview-prep/workspace",
          ["GET"],
          ["interview:read"],
        ),
        capabilityRoute(
          "/api/interview-prep/workspace",
          ["PUT"],
          ["interview:write"],
        ),
        capabilityRoute(
          "/api/interview-prep/ai/questions",
          ["POST"],
          ["interview:use", "ai:use"],
        ),
        capabilityRoute(
          "/api/interview-prep/ai/mock-turn",
          ["POST"],
          ["interview:use", "ai:use"],
        ),
        capabilityRoute(
          "/api/interview-prep/ai/feedback",
          ["POST"],
          ["interview:use", "ai:use"],
        ),
      ].filter((entry) => entry.requiredScopes.every((scope) => grantedScopes.has(scope)));
      const deniedPrefixes = [
        "/api/teams",
        "/api/applications/:applicationId/team-transfer",
        "/api/applications/:applicationId/team-visibility",
        ...state.deniedPrefixes,
      ];
      sendJson(response, 200, {
        ok: true,
        data: {
          schemaVersion: 2,
          scopeVersion: 2,
          credential,
          routePrefixes,
          deniedPrefixes,
        },
      });
      return;
    }
    if (
      request.method === "DELETE" &&
      url.pathname === "/api/codex/authorizations/current"
    ) {
      if (state.failNextRevoke) {
        state.failNextRevoke = false;
        sendJson(response, 503, {
          ok: false,
          error: { code: "TEMPORARY_FAILURE", message: "Try later" },
        });
        return;
      }
      state.revoked.add(accountIndex);
      state.revokeCalls += 1;
      response.writeHead(204);
      response.end();
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/applications/leak"
    ) {
      sendJson(response, 500, {
        ok: false,
        error: {
          code: "SERVER_ERROR",
          message: "Do not echo " + mockAccessToken(accountIndex),
        },
      });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/interview-prep/workspace"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: {
          subjectUserId: url.searchParams.get("subjectUserId") || "user-1",
          revision: 0,
          interviews: [],
          questions: [],
          mockSessions: [],
          feedback: [],
        },
      });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/applications/cross-origin-redirect"
    ) {
      response.writeHead(302, {
        location: "https://evil.example/api/collect",
      });
      response.end();
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/applications/same-origin-redirect"
    ) {
      response.writeHead(302, { location: "/api/applications" });
      response.end();
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/applications/share-result"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: {
          id: "share-1",
          token: "public-share-token-never-print",
          url: "/share/public-share-token-never-print",
          openaiApiKey: "provider-secret-never-print",
          smtpPass: "smtp-secret-never-print",
          callbackUrl:
            "https://example.test/callback#access_token=fragment-secret-never-print",
        },
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/applications/app-1/share"
    ) {
      await readRequest(request);
      state.shareCreates += 1;
      const token = "created-share-token-" + state.shareCreates;
      sendJson(response, 201, {
        ok: true,
        data: {
          id: "share-created-" + state.shareCreates,
          token,
          url: "/share/" + token,
        },
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/applications/app-1/share/share-1/rotate"
    ) {
      await readRequest(request);
      const token = mockAccessToken(accountIndex);
      sendJson(response, 201, {
        ok: true,
        data: {
          id: "share-unsafe",
          token,
          url: "/share/" + token,
        },
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/applications/app-1/communications/send"
    ) {
      await readRequest(request);
      state.communicationSendCalls += 1;
      sendJson(response, 201, {
        ok: true,
        data: { sent: true, call: state.communicationSendCalls },
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/applications/app-1/communications/classify"
    ) {
      const body = JSON.parse((await readRequest(request)).toString("utf8"));
      state.communicationClassificationRequests.push({
        body,
        idempotencyKey: request.headers["idempotency-key"] || null,
      });
      sendJson(response, 200, {
        ok: true,
        data: {
          updatedIds: body.communicationIds,
          communications: body.communicationIds.map((id) => ({
            id,
            mailClassification: {
              category: "interview_invite",
              confidence: 0.96,
            },
          })),
        },
      });
      return;
    }
    if (
      request.method === "PATCH" &&
      url.pathname === "/api/applications/app-1/communications/categories"
    ) {
      const body = JSON.parse((await readRequest(request)).toString("utf8"));
      state.communicationCategoryRequests.push({
        body,
        idempotencyKey: request.headers["idempotency-key"] || null,
      });
      sendJson(response, 200, {
        ok: true,
        data: {
          updatedIds: body.communicationIds,
          communications: body.communicationIds.map((id) => ({
            id,
            mailCategoryOverride: body.category,
          })),
        },
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/ai/keys") {
      const body = JSON.parse((await readRequest(request)).toString("utf8"));
      assert.equal(typeof body.apiKey, "string");
      if (body.provider === "error") {
        sendJson(response, 400, {
          ok: false,
          error: {
            code: "PROVIDER_REJECTED",
            message: "Provider rejected " + body.apiKey,
          },
        });
        return;
      }
      state.aiKeyCreates += 1;
      sendJson(response, 201, {
        ok: true,
        data: {
          id: "ai-key-" + state.aiKeyCreates,
          provider: body.provider,
          configured: true,
        },
      });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/codex/profile-recommenders"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: [
          {
            id: "recommender-1",
            name: "Professor Example",
            email: "professor@example.test",
          },
        ],
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/applications") {
      assert.equal(request.headers["x-phd-application-acknowledgement"], "v2");
      assert.equal(request.headers["x-phd-application-projection-version"], "2");
      const body = JSON.parse((await readRequest(request)).toString("utf8"));
      state.applicationCreatePosts.push(body);
      const suffix = body.program.includes("Team")
        ? "team"
        : body.program.includes("Tampered")
          ? "tampered"
          : "personal";
      const createdAt = "2026-08-02T12:00:00.000Z";
      const application = {
        id: "created-" + suffix,
        ownerId: body.ownerId || "user-" + accountIndex,
        teamId: body.teamId || null,
        teamTransferRequest: null,
        professor: {
          english: body.professor,
          chinese: body.professorChinese || "",
          email: body.professorEmail,
          phone: "",
          social: "",
          homepage: body.professorHomepage || "",
          research: body.notes || "Research fit notes to be added.",
          lab: "Lab information to be added.",
        },
        school: {
          name: body.university,
          country: body.country || "",
          website: body.website || "",
        },
        program: body.program,
        deadline: body.deadline,
        nextReminder: body.deadline,
        result: body.notes || "Draft created.",
        timeline: [
          {
            id: "timeline-" + suffix,
            title: "Draft created",
            date: "2026-08-02",
            note: body.notes || "Application workspace initialized.",
          },
        ],
        materials: [],
        tasks: [],
        communications: [],
        createdAt,
        updatedAt: createdAt,
      };
      state.createdApplications.set(application.id, application);
      const acknowledgement = mockCreateAcknowledgement(body, application, {
        ...(suffix === "tampered" ? { authorityHash: "A".repeat(43) } : {}),
      });
      sendJson(response, 201, { ok: true, data: acknowledgement });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname.startsWith("/api/applications/created-")
    ) {
      const applicationId = decodeURIComponent(
        url.pathname.slice("/api/applications/".length),
      );
      const application = state.createdApplications.get(applicationId);
      if (application) {
        state.createdApplicationReads.push(applicationId);
        sendJson(response, 200, { ok: true, data: application });
        return;
      }
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/applications/app-1"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: state.application,
      });
      return;
    }
    if (request.method === "PATCH" && url.pathname === "/api/settings") {
      const body = JSON.parse((await readRequest(request)).toString("utf8"));
      const mutationId = request.headers["x-phd-settings-mutation-id"];
      assert.equal(request.headers["x-phd-settings-acknowledgement"], "v1");
      assert.match(mutationId, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/);
      state.settingsVersion += 1;
      const secretReceipts = {};
      if (Object.prototype.hasOwnProperty.call(body, "smtpPass")) {
        secretReceipts.smtpPass = {
          operation: "set",
          present: true,
          version: state.settingsVersion,
        };
      } else if (body.clearSmtpPass === true) {
        secretReceipts.smtpPass = {
          operation: "clear",
          present: false,
          version: state.settingsVersion,
        };
      }
      if (Object.prototype.hasOwnProperty.call(body, "incomingPass")) {
        secretReceipts.incomingPass = {
          operation: "set",
          present: true,
          version: state.settingsVersion,
        };
      } else if (body.clearIncomingPass === true) {
        secretReceipts.incomingPass = {
          operation: "clear",
          present: false,
          version: state.settingsVersion,
        };
      }
      for (const [field, value] of Object.entries(body)) {
        if (!["smtpPass", "clearSmtpPass", "incomingPass", "clearIncomingPass"].includes(field)) {
          state.settings[field] = value;
        }
      }
      state.settingsAcknowledgementRequests.push({ body, mutationId });
      const acknowledgement = {
        protocol: "phd-atlas-settings-ack-v1",
        durable: true,
        mutationId,
        settingsVersion: state.settingsVersion,
        user: {
          id: "user-" + accountIndex,
          email: "user" + accountIndex + "@example.test",
          name: "User " + accountIndex,
          settingsVersion: state.settingsVersion,
          settings: { ...state.settings },
        },
        secretReceipts,
      };
      if (state.malformedNextSettingsAcknowledgement) {
        state.malformedNextSettingsAcknowledgement = false;
        delete acknowledgement.mutationId;
      }
      sendJson(response, 200, { ok: true, data: acknowledgement });
      return;
    }
    if (
      request.method === "PUT" &&
      url.pathname === "/api/applications/app-1"
    ) {
      assert.equal(request.headers["x-phd-application-acknowledgement"], "v2");
      assert.equal(request.headers["x-phd-application-projection-version"], "2");
      const body = JSON.parse((await readRequest(request)).toString("utf8"));
      state.application = body;
      state.applicationPuts.push(body);
      sendJson(response, 200, {
        ok: true,
        data: state.application,
      });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/applications/app-1/export"
    ) {
      const body = Buffer.from("binary-export-content");
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": body.length,
      });
      response.end(body);
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/applications/app-1/files"
    ) {
      const uploadRequestGate = state.nextUploadRequestGate;
      if (uploadRequestGate) {
        state.nextUploadRequestGate = null;
        uploadRequestGate.reached.resolve();
        await uploadRequestGate.release.promise;
      }
      const body = await readRequest(request);
      state.uploadRequests += 1;
      state.uploadBytes = body.length;
      state.lastUploadBody = body;
      sendJson(response, 201, {
        ok: true,
        data: { uploaded: true },
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/applications") {
      sendJson(response, 200, {
        ok: true,
        data: [{ id: "app-1", owner: "user-" + accountIndex }],
      });
      return;
    }
    if (
      request.method === "DELETE" &&
      url.pathname === "/api/applications/app-1"
    ) {
      sendJson(response, 200, { ok: true, data: { deleted: true } });
      return;
    }
    sendJson(response, 404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "Not found" },
    });
  });
  return { server, state };
}

function runCli(configDirectory, args, expectedCode = 0, stdinText) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: {
        ...process.env,
        PHD_ATLAS_CONFIG_DIR: configDirectory,
        PHD_ATLAS_DISABLE_BROWSER_OPEN: "1",
        ...(transferRootByConfigDirectory.has(configDirectory)
          ? {
              PHD_ATLAS_TRANSFER_ROOTS:
                transferRootByConfigDirectory.get(configDirectory),
            }
          : {}),
      },
      windowsHide: true,
      stdio: [stdinText === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("CLI command timed out: " + args.join(" ")));
    }, 15_000);
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      const result = {
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      try {
        assert.equal(
          code,
          expectedCode,
          "unexpected exit for " +
            args.join(" ") +
            "\nstdout: " +
            result.stdout +
            "\nstderr: " +
            result.stderr,
        );
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
    if (stdinText !== undefined) {
      child.stdin.end(stdinText);
    }
  });
}

function runMcp(configDirectory, messages, label = "MCP", options = {}) {
  return new Promise((resolve, reject) => {
    const expectedResponseIds = messages.flatMap((message) => {
      if (typeof message === "string" || Array.isArray(message)) {
        return [null];
      }
      if (
        !message ||
        typeof message !== "object" ||
        !Object.prototype.hasOwnProperty.call(message, "id")
      ) {
        return [];
      }
      return [
        typeof message.id === "string" ||
        (typeof message.id === "number" && Number.isInteger(message.id))
          ? message.id
          : null,
      ];
    });
    const child = spawn(process.execPath, [cliPath, "mcp"], {
      env: {
        ...process.env,
        PHD_ATLAS_CONFIG_DIR: configDirectory,
        PHD_ATLAS_DISABLE_BROWSER_OPEN: "1",
        ...(transferRootByConfigDirectory.has(configDirectory)
          ? {
              PHD_ATLAS_TRANSFER_ROOTS:
                transferRootByConfigDirectory.get(configDirectory),
            }
          : {}),
      },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let inputClosed = false;
    const closeInputAfterResponses = () => {
      if (inputClosed) {
        return;
      }
      const responseCount = Buffer.concat(stdout)
        .toString("utf8")
        .split("\n")
        .filter((line) => line.trim()).length;
      if (responseCount >= expectedResponseIds.length) {
        inputClosed = true;
        child.stdin.end();
      }
    };
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("MCP process timed out"));
    }, 15_000);
    child.stdout.on("data", (chunk) => {
      stdout.push(Buffer.from(chunk));
      closeInputAfterResponses();
    });
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      try {
        assert.equal(
          code,
          0,
          label +
            " exited unexpectedly\nstdout: " +
            Buffer.concat(stdout).toString("utf8") +
            "\nstderr: " +
            Buffer.concat(stderr).toString("utf8"),
        );
        const rawStdout = Buffer.concat(stdout).toString("utf8");
        const parsedLines = rawStdout
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line));
        const remainingLines = [...parsedLines];
        const orderedLines = expectedResponseIds.map((expectedId) => {
          const index = remainingLines.findIndex((line) =>
            Object.is(line.id, expectedId),
          );
          assert.notEqual(
            index,
            -1,
            "missing MCP response for id " + JSON.stringify(expectedId),
          );
          return remainingLines.splice(index, 1)[0];
        });
        orderedLines.push(...remainingLines);
        resolve({
          lines: orderedLines,
          stdout: rawStdout,
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      } catch (error) {
        reject(error);
      }
    });
    for (const message of messages) {
      child.stdin.write(
        (typeof message === "string" ? message : JSON.stringify(message)) +
          "\n",
      );
    }
    if (options.closeInputImmediately === true) {
      inputClosed = true;
      child.stdin.end();
    } else if (expectedResponseIds.length === 0) {
      closeInputAfterResponses();
    }
  });
}

function assertMcpToolError(message, code) {
  assert.ok(message && typeof message === "object");
  assert.equal(message.error, undefined);
  assert.equal(message.result?.isError, true);
  assert.equal(
    message.result.structuredContent,
    undefined,
    "tool execution errors must not violate the success outputSchema",
  );
  assert.equal(message.result.content?.length, 1);
  assert.equal(message.result.content[0].type, "text");
  assert.match(message.result.content[0].text, new RegExp("^" + code + ":"));
  return message.result.content[0].text;
}

function assertMcpProtocolError(message, rpcCode, dataCode) {
  assert.equal(message.result, undefined);
  assert.equal(message.error?.code, rpcCode);
  if (dataCode !== undefined) {
    assert.equal(message.error.data?.code, dataCode);
  }
  return message.error;
}

async function tryCreateFileSymlink(target, link) {
  try {
    await fs.symlink(target, link, "file");
    return true;
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "UNKNOWN"].includes(error?.code)) {
      return false;
    }
    throw error;
  }
}

test("client and server advertise the same current scope-v2 contract", async () => {
  const [{ SUPPORTED_SCOPES }, { CODEX_AUTHORIZATION_SCOPES }] = await Promise.all([
    import(pathToFileURL(cliPath).href),
    import(pathToFileURL(serverAuthorizationPath).href),
  ]);
  assert.deepEqual(SUPPORTED_SCOPES, CODEX_AUTHORIZATION_SCOPES);
  assert.equal(SUPPORTED_SCOPES.includes("teams:read"), false);
  assert.equal(SUPPORTED_SCOPES.includes("teams:write"), false);
});

test("MCP stdio implements the JSON-RPC lifecycle and error contract", async (context) => {
  const configDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "phd-atlas-mcp-protocol-"),
  );
  context.after(async () => {
    await fs.rm(configDirectory, { recursive: true, force: true });
  });

  const mcp = await runMcp(configDirectory, [
    "{not-json",
    [],
    {
      jsonrpc: "2.0",
      id: "before-initialize",
      method: "tools/list",
      params: {},
    },
    {
      jsonrpc: "1.0",
      id: "wrong-version",
      method: "initialize",
      params: {},
    },
    {
      jsonrpc: "2.0",
      id: 1.5,
      method: "initialize",
      params: {},
    },
    {
      jsonrpc: "2.0",
      method: "notifications/unknown",
      params: { ignored: true },
    },
    {
      jsonrpc: "2.0",
      id: "invalid-initialize-params",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
      },
    },
    {
      jsonrpc: "2.0",
      id: "initialize",
      method: "initialize",
      params: mcpInitializeParams,
    },
    {
      jsonrpc: "2.0",
      id: "initialize-again",
      method: "initialize",
      params: mcpInitializeParams,
    },
    {
      jsonrpc: "2.0",
      id: "list-before-ready",
      method: "tools/list",
      params: {},
    },
    {
      jsonrpc: "2.0",
      id: "initialized-as-request",
      method: "notifications/initialized",
      params: {},
    },
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    },
    {
      jsonrpc: "2.0",
      id: "invalid-list-cursor",
      method: "tools/list",
      params: { cursor: 42 },
    },
    { jsonrpc: "2.0", id: "list", method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: "ping", method: "ping", params: {} },
    {
      jsonrpc: "2.0",
      id: "missing-method",
      method: "resources/list",
      params: {},
    },
    {
      jsonrpc: "2.0",
      id: "invalid-tool-params",
      method: "tools/call",
      params: {},
    },
    {
      jsonrpc: "2.0",
      id: "unknown-tool",
      method: "tools/call",
      params: { name: "phd_atlas_not_real", arguments: {} },
    },
    {
      jsonrpc: "2.0",
      id: "invalid-arguments",
      method: "tools/call",
      params: { name: "phd_atlas_accounts_list", arguments: false },
    },
    {
      jsonrpc: "2.0",
      id: "accounts",
      method: "tools/call",
      params: { name: "phd_atlas_accounts_list", arguments: {} },
    },
    "X".repeat(2 * 1024 * 1024 + 1),
  ]);

  assert.equal(mcp.stderr, "");
  for (const message of mcp.lines) {
    assert.equal(message.jsonrpc, "2.0");
    assert.ok(Object.prototype.hasOwnProperty.call(message, "id"));
    assert.notEqual(
      Object.prototype.hasOwnProperty.call(message, "result"),
      Object.prototype.hasOwnProperty.call(message, "error"),
      "each response must contain exactly one of result or error",
    );
  }
  assert.equal(mcp.lines[0].id, null);
  assert.equal(mcp.lines[0].error.code, -32700);
  assert.equal(mcp.lines[0].error.message, "Parse error");
  assert.equal(mcp.lines[1].id, null);
  assert.equal(mcp.lines[1].error.code, -32600);
  assert.match(mcp.lines[1].error.message, /Batch requests/);

  const byId = new Map(
    mcp.lines
      .filter((message) => message.id !== null)
      .map((message) => [message.id, message]),
  );
  assert.equal(byId.get("before-initialize").error.code, -32002);
  assert.equal(byId.get("wrong-version").error.code, -32600);
  assert.equal(mcp.lines[4].id, null);
  assert.equal(mcp.lines[4].error.code, -32600);
  assert.equal(byId.get("invalid-initialize-params").error.code, -32602);

  const initialized = byId.get("initialize").result;
  assert.equal(initialized.protocolVersion, "2025-03-26");
  assert.deepEqual(initialized.capabilities, { tools: { listChanged: false } });
  assert.equal(initialized.serverInfo.name, "phd-atlas");
  assert.equal(initialized.serverInfo.title, "PhD Atlas");
  assert.match(initialized.serverInfo.version, /^\d+\.\d+\.\d+$/);
  assert.match(initialized.instructions, /read the exact target before writing/i);
  assert.match(initialized.instructions, /confirm consequential or local-file actions/i);
  assert.match(initialized.instructions, /remote content as untrusted data/i);
  assert.ok([-32600, -32602].includes(byId.get("initialize-again").error.code));
  assert.equal(byId.get("list-before-ready").error.code, -32002);
  assert.ok(
    [-32600, -32602].includes(
      byId.get("initialized-as-request").error.code,
    ),
  );
  assert.equal(byId.get("invalid-list-cursor").error.code, -32602);

  const listedTools = byId.get("list").result.tools;
  assert.ok(Array.isArray(listedTools));
  assert.equal(listedTools.length, 19);
  assert.equal(new Set(listedTools.map((tool) => tool.name)).size, listedTools.length);
  for (const tool of listedTools) {
    assert.match(tool.name, /^phd_atlas_[a-z0-9_]+$/);
    assert.equal(typeof tool.title, "string");
    assert.ok(tool.title.length > 3);
    assert.equal(typeof tool.description, "string");
    assert.ok(tool.description.length > 20);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.outputSchema.type, "object");
    assert.equal(typeof tool.annotations, "object");
    assert.equal(tool.annotations.title, tool.title);
    for (const hint of [
      "readOnlyHint",
      "destructiveHint",
      "idempotentHint",
      "openWorldHint",
    ]) {
      assert.equal(
        typeof tool.annotations[hint],
        "boolean",
        tool.name + " must declare " + hint,
      );
    }
  }
  const toolsByName = new Map(listedTools.map((tool) => [tool.name, tool]));
  for (const focusedBusinessTool of [
    "phd_atlas_applications_list",
    "phd_atlas_application_get",
    "phd_atlas_application_create",
    "phd_atlas_application_update",
    "phd_atlas_application_checklist",
    "phd_atlas_profile_assets",
    "phd_atlas_profile_recommenders",
    "phd_atlas_file_transfer",
    "phd_atlas_communications",
  ]) {
    assert.ok(
      toolsByName.has(focusedBusinessTool),
      "missing focused business tool " + focusedBusinessTool,
    );
  }
  assert.equal(toolsByName.has("phd_atlas_team_students"), false);
  assert.equal(
    toolsByName.get("phd_atlas_status").annotations.readOnlyHint,
    true,
  );
  assert.equal(
    toolsByName.get("phd_atlas_status").annotations.destructiveHint,
    false,
  );
  assert.equal(
    toolsByName.get("phd_atlas_status").annotations.idempotentHint,
    true,
  );
  assert.equal(
    toolsByName.get("phd_atlas_status").annotations.openWorldHint,
    false,
  );
  assert.equal(
    toolsByName.get("phd_atlas_api").annotations.destructiveHint,
    true,
  );
  assert.equal(
    toolsByName.get("phd_atlas_logout").annotations.destructiveHint,
    true,
  );

  assert.deepEqual(byId.get("ping").result, {});
  assert.equal(byId.get("missing-method").error.code, -32601);
  assert.equal(byId.get("invalid-tool-params").error.code, -32602);

  assert.equal(byId.get("unknown-tool").error.code, -32602);
  assert.match(byId.get("unknown-tool").error.message, /unknown tool/i);
  assert.equal(byId.get("invalid-arguments").error.code, -32602);

  const accounts = byId.get("accounts").result;
  assert.equal(accounts.isError, undefined);
  assert.deepEqual(JSON.parse(accounts.content[0].text), accounts.structuredContent);
  assert.deepEqual(accounts.structuredContent.accounts, []);
  assert.equal(accounts.structuredContent.activeAccountId ?? null, null);
  assert.equal(mcp.lines.at(-1).id, null);
  assert.equal(mcp.lines.at(-1).error.code, -32700);
  assert.equal(mcp.lines.at(-1).error.message, "Message too large");

  assert.equal(
    mcp.lines.length,
    19,
    "notifications must not emit JSON-RPC responses",
  );

  const unsupportedProtocol = await runMcp(configDirectory, [
    {
      jsonrpc: "2.0",
      id: "negotiate",
      method: "initialize",
      params: {
        ...mcpInitializeParams,
        protocolVersion: "2099-01-01",
      },
    },
  ]);
  assert.equal(
    unsupportedProtocol.lines[0].result.protocolVersion,
    "2025-11-25",
  );
});

test("CLI and MCP keep multi-account device credentials private", async (context) => {
  const configDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "phd-atlas-cli-test-"),
  );
  const transferDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "phd-atlas-cli-transfer-"),
  );
  const outsideTransferDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "phd-atlas-cli-outside-transfer-"),
  );
  transferRootByConfigDirectory.set(configDirectory, transferDirectory);
  context.after(async () => {
    transferRootByConfigDirectory.delete(configDirectory);
    await fs.rm(configDirectory, { recursive: true, force: true });
    await fs.rm(transferDirectory, { recursive: true, force: true });
    await fs.rm(outsideTransferDirectory, { recursive: true, force: true });
  });
  const { server, state } = createMockServer();
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      state.origin = "http://127.0.0.1:" + address.port;
      resolve();
    });
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const staleLock = path.join(configDirectory, "config.lock");
  await fs.writeFile(staleLock, "{\"stale\":true}");
  const oldTime = new Date(Date.now() - 60_000);
  await fs.utimes(staleLock, oldTime, oldTime);

  const startOne = await runCli(configDirectory, [
    "login",
    "start",
    "--server",
    state.origin,
    "--name",
    "First",
    "--json",
  ]);
  const startOneData = JSON.parse(startOne.stdout);
  assert.equal(startOneData.userCode, mockUserCode(1));
  assert.equal(startOneData.pollIntervalSeconds, 5);
  assert.ok(!startOne.stdout.includes(mockDeviceCode(1)));
  await assert.rejects(fs.stat(staleLock), { code: "ENOENT" });

  const pending = await runCli(
    configDirectory,
    ["login", "finish", startOneData.loginId, "--json"],
    2,
  );
  assert.equal(JSON.parse(pending.stdout).status, "authorization_pending");
  assert.ok(!pending.stdout.includes(mockDeviceCode(1)));

  const finishOne = await runCli(configDirectory, [
    "login",
    "finish",
    startOneData.loginId,
    "--wait",
    "--json",
  ]);
  assert.equal(JSON.parse(finishOne.stdout).status, "connected");
  assert.ok(!finishOne.stdout.includes(mockAccessToken(1)));
  assert.ok(!finishOne.stderr.includes(mockAccessToken(1)));

  const startTwo = JSON.parse(
    (
      await runCli(configDirectory, [
        "login",
        "start",
        "--server",
        state.origin,
        "--name",
        "Second",
        "--json",
      ])
    ).stdout,
  );
  await runCli(configDirectory, [
    "login",
    "finish",
    startTwo.loginId,
    "--json",
  ]);

  for (const invalidDeviceCode of [
    "not-base64url",
    "A".repeat(700),
  ]) {
    state.nextDeviceCodeOverride = invalidDeviceCode;
    const rejectedDevice = await runCli(
      configDirectory,
      ["login", "start", "--server", state.origin, "--json"],
      1,
    );
    assert.match(rejectedDevice.stderr, /INVALID_SERVER_RESPONSE/);
    assert.ok(
      !(await fs.readFile(path.join(configDirectory, "config.json"), "utf8"))
        .includes(invalidDeviceCode),
    );
  }

  for (const invalidTokenMode of ["malformed_token", "oversized_token"]) {
    state.nextDeviceMode = invalidTokenMode;
    const invalidTokenStart = JSON.parse(
      (
        await runCli(configDirectory, [
          "login",
          "start",
          "--server",
          state.origin,
          "--name",
          invalidTokenMode,
          "--json",
        ])
      ).stdout,
    );
    const rejectedToken = await runCli(
      configDirectory,
      ["login", "finish", invalidTokenStart.loginId, "--json"],
      1,
    );
    assert.match(rejectedToken.stderr, /INVALID_SERVER_RESPONSE/);
    const afterRejectedToken = await fs.readFile(
      path.join(configDirectory, "config.json"),
      "utf8",
    );
    assert.ok(!afterRejectedToken.includes("not-a-phd-atlas-token"));
    assert.ok(!afterRejectedToken.includes("A".repeat(200)));
    const accountsAfterRejectedToken = JSON.parse(
      (await runCli(configDirectory, ["accounts", "list", "--json"])).stdout,
    );
    assert.equal(accountsAfterRejectedToken.accounts.length, 2);
    await discardMockPendingLogin(configDirectory, invalidTokenStart.loginId);
  }

  for (const overgrantCase of [
    {
      mode: "scope_overgrant",
      startOptions: ["--scope", "applications:read"],
    },
    {
      mode: "expiry_overgrant",
      startOptions: ["--expires-in-days", "30"],
    },
  ]) {
    state.nextDeviceMode = overgrantCase.mode;
    const overgrantStart = JSON.parse(
      (
        await runCli(configDirectory, [
          "login",
          "start",
          "--server",
          state.origin,
          "--name",
          overgrantCase.mode,
          ...overgrantCase.startOptions,
          "--json",
        ])
      ).stdout,
    );
    if (overgrantCase.mode === "scope_overgrant") {
      assert.deepEqual(overgrantStart.requestedScopes, ["applications:read"]);
    }
    const overgrantIndex = state.starts;
    const rejectedOvergrant = await runCli(
      configDirectory,
      ["login", "finish", overgrantStart.loginId, "--json"],
      1,
    );
    assert.match(rejectedOvergrant.stderr, /GRANT_EXCEEDS_REQUEST/);
    assert.ok(!rejectedOvergrant.stderr.includes(mockAccessToken(overgrantIndex)));
    const afterOvergrant = JSON.parse(
      (await runCli(configDirectory, ["accounts", "list", "--json"])).stdout,
    );
    assert.equal(afterOvergrant.accounts.length, 2);
    const quarantinedOvergrant = afterOvergrant.pendingLogins.find(
      (pendingLogin) => pendingLogin.loginId === overgrantStart.loginId,
    );
    assert.equal(quarantinedOvergrant?.credentialQuarantined, true);
    assert.equal(state.exchangeCalls.get(overgrantIndex), 1);
    await discardMockPendingLogin(configDirectory, overgrantStart.loginId);
  }

  const retryIdentityStart = JSON.parse(
    (
      await runCli(configDirectory, [
        "login",
        "start",
        "--server",
        state.origin,
        "--name",
        "Retry identity",
        "--json",
      ])
    ).stdout,
  );
  const retryIdentityIndex = state.starts;
  state.whoamiFailures.set(retryIdentityIndex, 1);
  const quarantinedIdentity = await runCli(
    configDirectory,
    ["login", "finish", retryIdentityStart.loginId, "--json"],
    1,
  );
  assert.match(quarantinedIdentity.stderr, /IDENTITY_VERIFICATION_PENDING/);
  const accountsWhileQuarantined = JSON.parse(
    (await runCli(configDirectory, ["accounts", "list", "--json"])).stdout,
  );
  assert.equal(accountsWhileQuarantined.accounts.length, 2);
  assert.ok(
    accountsWhileQuarantined.pendingLogins.some(
      (pendingLogin) => pendingLogin.loginId === retryIdentityStart.loginId,
    ),
  );
  const exchangedBeforeRetry = state.exchangeCalls.get(retryIdentityIndex);
  const configWithExchangedToken = JSON.parse(
    await fs.readFile(path.join(configDirectory, "config.json"), "utf8"),
  );
  configWithExchangedToken.pendingLogins[
    retryIdentityStart.loginId
  ].expiresAt = new Date(Date.now() - 1_000).toISOString();
  await fs.writeFile(
    path.join(configDirectory, "config.json"),
    JSON.stringify(configWithExchangedToken, null, 2) + "\n",
  );
  const cleanupTriggerLogin = JSON.parse(
    (
      await runCli(configDirectory, [
        "login",
        "start",
        "--server",
        state.origin,
        "--name",
        "Device TTL cleanup trigger",
        "--json",
      ])
    ).stdout,
  );
  const afterDeviceTtl = JSON.parse(
    (await runCli(configDirectory, ["accounts", "list", "--json"])).stdout,
  );
  assert.equal(
    afterDeviceTtl.pendingLogins.find(
      (pendingLogin) => pendingLogin.loginId === retryIdentityStart.loginId,
    )?.credentialQuarantined,
    true,
    "an exchanged token must survive device-code TTL cleanup",
  );
  assert.equal(state.exchangeCalls.get(retryIdentityIndex), exchangedBeforeRetry);
  await discardMockPendingLogin(configDirectory, cleanupTriggerLogin.loginId);
  const verifiedAfterRetry = JSON.parse(
    (
      await runCli(configDirectory, [
        "login",
        "finish",
        retryIdentityStart.loginId,
        "--json",
      ])
    ).stdout,
  );
  assert.equal(verifiedAfterRetry.status, "connected");
  assert.equal(state.exchangeCalls.get(retryIdentityIndex), exchangedBeforeRetry);
  await runCli(configDirectory, [
    "logout",
    "--account",
    verifiedAfterRetry.account.id,
    "--local-only",
    "--confirm",
    "--json",
  ]);

  const invalidExpiry = await runCli(
    configDirectory,
    [
      "login",
      "start",
      "--server",
      state.origin,
      "--expires-in-days",
      "31",
      "--json",
    ],
    1,
  );
  assert.match(invalidExpiry.stderr, /30, 90, 180, or 365/);

  state.nextDeviceMode = "slow_down";
  const slowStart = JSON.parse(
    (
      await runCli(configDirectory, [
        "login",
        "start",
        "--server",
        state.origin,
        "--name",
        "Slow",
        "--json",
      ])
    ).stdout,
  );
  const slowFinish = await runCli(
    configDirectory,
    ["login", "finish", slowStart.loginId, "--json"],
    2,
  );
  assert.equal(JSON.parse(slowFinish.stdout).status, "slow_down");
  assert.equal(JSON.parse(slowFinish.stdout).retryAfterSeconds, 10);

  for (const mode of ["denied", "expired"]) {
    state.nextDeviceMode = mode;
    const modeStart = JSON.parse(
      (
        await runCli(configDirectory, [
          "login",
          "start",
          "--server",
          state.origin,
          "--name",
          mode,
          "--json",
        ])
      ).stdout,
    );
    const modeFinish = await runCli(
      configDirectory,
      ["login", "finish", modeStart.loginId, "--json"],
      1,
    );
    assert.match(
      modeFinish.stderr,
      mode === "denied" ? /AUTHORIZATION_DENIED/ : /AUTHORIZATION_EXPIRED/,
    );
    const afterTerminalDeviceError = JSON.parse(
      (await runCli(configDirectory, ["accounts", "list", "--json"])).stdout,
    );
    assert.ok(
      !afterTerminalDeviceError.pendingLogins.some(
        (pendingLogin) => pendingLogin.loginId === modeStart.loginId,
      ),
    );
  }

  const loopbackPort = new URL(state.origin).port;
  state.nextDeviceMode = "denied";
  state.verificationBase = "http://localhost:" + loopbackPort;
  const loopbackVerification = JSON.parse(
    (
      await runCli(configDirectory, [
        "login",
        "start",
        "--server",
        state.origin,
        "--json",
      ])
    ).stdout,
  );
  assert.match(loopbackVerification.verificationUri, /^http:\/\/localhost:/);
  await runCli(
    configDirectory,
    ["login", "finish", loopbackVerification.loginId, "--json"],
    1,
  );

  state.verificationBase = "https://phishing.example";
  const crossOriginVerification = await runCli(
    configDirectory,
    ["login", "start", "--server", state.origin, "--json"],
    1,
  );
  assert.match(crossOriginVerification.stderr, /UNSAFE_VERIFICATION_URL/);
  assert.ok(!crossOriginVerification.stderr.includes("phishing.example"));

  state.verificationBase = state.origin.replace(
    "http://",
    "http://user:password@",
  );
  const unsafeVerification = await runCli(
    configDirectory,
    ["login", "start", "--server", state.origin, "--json"],
    1,
  );
  assert.match(unsafeVerification.stderr, /UNSAFE_VERIFICATION_URL/);
  assert.ok(!unsafeVerification.stderr.includes("password"));
  state.verificationBase = null;

  const listed = JSON.parse(
    (await runCli(configDirectory, ["accounts", "list", "--json"])).stdout,
  );
  assert.equal(listed.accounts.length, 2);
  const first = listed.accounts.find((account) => account.name === "First");
  const second = listed.accounts.find((account) => account.name === "Second");
  assert.ok(first);
  assert.ok(second);
  assert.ok(!JSON.stringify(listed).includes(mockAccessToken(1)));
  assert.ok(!JSON.stringify(listed).includes(mockAccessToken(2)));

  await runCli(configDirectory, ["accounts", "use", first.id, "--json"]);
  const identity = JSON.parse(
    (await runCli(configDirectory, ["whoami", "--json"])).stdout,
  );
  assert.equal(identity.identity.user.id, "user-1");

  const applications = JSON.parse(
    (
      await runCli(configDirectory, [
        "api",
        "GET",
        "/api/applications",
        "--json",
      ])
    ).stdout,
  );
  assert.equal(applications.data[0].owner, "user-1");
  const recommenders = JSON.parse(
    (
      await runCli(configDirectory, [
        "api",
        "GET",
        "/api/codex/profile-recommenders",
        "--json",
      ])
    ).stdout,
  );
  assert.equal(recommenders.data[0].id, "recommender-1");

  state.capabilityMode = "malformed";
  const malformedCapability = await runCli(
    configDirectory,
    ["api", "GET", "/api/applications", "--json"],
    1,
  );
  assert.match(malformedCapability.stderr, /INVALID_CAPABILITY_MANIFEST/);
  state.capabilityMode = "unsupported";
  const unsupportedCapability = await runCli(
    configDirectory,
    ["capabilities", "--json"],
    1,
  );
  assert.match(unsupportedCapability.stderr, /INVALID_CAPABILITY_MANIFEST/);
  state.capabilityMode = "reauth";
  const reauthorizationRequired = await runCli(
    configDirectory,
    ["api", "GET", "/api/applications", "--json"],
    1,
  );
  assert.match(
    reauthorizationRequired.stderr,
    /REAUTHORIZATION_REQUIRED/,
  );
  state.capabilityMode = "malformed-condition";
  const malformedConditionalCapability = await runCli(
    configDirectory,
    ["capabilities", "--json"],
    1,
  );
  assert.match(
    malformedConditionalCapability.stderr,
    /INVALID_CAPABILITY_MANIFEST/,
  );
  state.capabilityMode = "valid";

  state.omitFilesReadFromCapabilities = true;
  await syncStoredMockScopes(configDirectory, first.id, state);
  for (const overlappingMode of [
    "duplicate-condition",
    "overlapping-condition",
  ]) {
    state.capabilityMode = overlappingMode;
    const overlappingConditionalCapability = await runCli(
      configDirectory,
      [
        "api",
        "POST",
        "/api/applications/app-1/communications/send",
        "--data",
        JSON.stringify({
          subject: "Overlapping manifest",
          attachments: [{ fileId: "file-shadow", fileName: "shadow.pdf" }],
        }),
        "--confirm",
        "--json",
      ],
      1,
    );
    assert.match(
      overlappingConditionalCapability.stderr,
      /CONDITIONAL_SCOPE_REQUIRED/,
    );
    assert.equal(state.communicationSendCalls, 0);
  }
  state.capabilityMode = "noncanonical-prefix";
  const noncanonicalConditionalCapability = await runCli(
    configDirectory,
    ["capabilities", "--json"],
    1,
  );
  assert.match(
    noncanonicalConditionalCapability.stderr,
    /INVALID_CAPABILITY_MANIFEST/,
  );
  state.capabilityMode = "noncanonical-denied-prefix";
  const noncanonicalDeniedCapability = await runCli(
    configDirectory,
    ["capabilities", "--json"],
    1,
  );
  assert.match(
    noncanonicalDeniedCapability.stderr,
    /INVALID_CAPABILITY_MANIFEST/,
  );
  state.capabilityMode = "valid";

  const plainSend = JSON.parse(
    (
      await runCli(configDirectory, [
        "api",
        "POST",
        "/api/applications/app-1/communications/send",
        "--data",
        JSON.stringify({ subject: "Plain", attachments: [] }),
        "--confirm",
        "--json",
      ])
    ).stdout,
  );
  assert.equal(plainSend.data.sent, true);
  assert.equal(state.communicationSendCalls, 1);

  const existingAttachmentWithoutScope = await runCli(
    configDirectory,
    [
      "api",
      "POST",
      "/api/applications/app-1/communications/send",
      "--data",
      JSON.stringify({
        subject: "Existing attachment",
        attachments: [{ fileId: "file-1", fileName: "cv.pdf" }],
      }),
      "--confirm",
      "--json",
    ],
    1,
  );
  assert.match(
    existingAttachmentWithoutScope.stderr,
    /CONDITIONAL_SCOPE_REQUIRED/,
  );
  assert.match(existingAttachmentWithoutScope.stderr, /files:read/);
  assert.equal(state.communicationSendCalls, 1);

  const malformedConditionalInput = await runCli(
    configDirectory,
    [
      "api",
      "POST",
      "/api/applications/app-1/communications/send",
      "--data",
      JSON.stringify({
        subject: "Malformed attachments",
        attachments: { fileId: "file-hidden" },
      }),
      "--confirm",
      "--json",
    ],
    1,
  );
  assert.match(malformedConditionalInput.stderr, /CONDITIONAL_INPUT_INVALID/);
  assert.equal(state.communicationSendCalls, 1);

  const mcpConditionalPreflight = await runMcp(configDirectory, [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: mcpInitializeParams,
    },
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "phd_atlas_api",
        arguments: {
          account: first.id,
          method: "POST",
          path: "/api/applications/app-1/communications/send",
          data: {
            subject: "MCP existing attachment",
            attachments: [{ fileId: "file-2", fileName: "proposal.pdf" }],
          },
          confirm: true,
        },
      },
    },
  ]);
  assertMcpToolError(
    mcpConditionalPreflight.lines[1],
    "CONDITIONAL_SCOPE_REQUIRED",
  );
  assert.equal(state.communicationSendCalls, 1);

  state.omitFilesReadFromCapabilities = false;
  await syncStoredMockScopes(configDirectory, first.id, state);
  const existingAttachmentWithScope = JSON.parse(
    (
      await runCli(configDirectory, [
        "api",
        "POST",
        "/api/applications/app-1/communications/send",
        "--data",
        JSON.stringify({
          subject: "Existing attachment",
          attachments: [{ fileId: "file-1", fileName: "cv.pdf" }],
        }),
        "--confirm",
        "--json",
      ])
    ).stdout,
  );
  assert.equal(existingAttachmentWithScope.data.sent, true);
  assert.equal(state.communicationSendCalls, 2);

  const unmapped = await runCli(
    configDirectory,
    ["api", "GET", "/api/files", "--json"],
    1,
  );
  assert.match(unmapped.stderr, /CAPABILITY_NOT_GRANTED/);
  state.deniedPrefixes = ["/api/admin", "/api/applications/blocked"];
  const capabilityDenied = await runCli(
    configDirectory,
    ["api", "GET", "/api/applications/blocked", "--json"],
    1,
  );
  assert.match(capabilityDenied.stderr, /CAPABILITY_DENIED/);
  state.deniedPrefixes = ["/api/admin"];

  const forbidden = await runCli(
    configDirectory,
    ["api", "GET", "/api/auth/me", "--json"],
    1,
  );
  assert.match(forbidden.stderr, /FORBIDDEN_API_PATH/);
  const doubleEncodedAdmin = await runCli(
    configDirectory,
    ["api", "GET", "/api/%2561dmin/users", "--json"],
    1,
  );
  assert.match(doubleEncodedAdmin.stderr, /FORBIDDEN_API_PATH/);
  const encodedControl = await runCli(
    configDirectory,
    ["api", "GET", "/api/applications/%2500", "--json"],
    1,
  );
  assert.match(encodedControl.stderr, /INVALID_API_PATH/);
  const absolute = await runCli(
    configDirectory,
    ["api", "GET", "https://evil.test/api/applications", "--json"],
    1,
  );
  assert.match(absolute.stderr, /INVALID_API_PATH/);
  const unconfirmed = await runCli(
    configDirectory,
    ["api", "DELETE", "/api/applications/app-1", "--json"],
    1,
  );
  assert.match(unconfirmed.stderr, /CONFIRMATION_REQUIRED/);
  for (const sideEffectPath of [
    "/api/applications/app-1/request-feedback",
    "/api/discover/programs/delete",
    "/api/settings/test-email",
    "/api/settings/test-incoming-mail",
    "/api/settings/receive-email-verification",
  ]) {
    const unconfirmedSideEffect = await runCli(
      configDirectory,
      ["api", "POST", sideEffectPath, "--data", "{}", "--json"],
      1,
    );
    assert.match(unconfirmedSideEffect.stderr, /CONFIRMATION_REQUIRED/);
  }
  const classificationBody = JSON.stringify({
    communicationIds: ["communication-1"],
    keyId: "key-1",
    force: false,
  });
  const unconfirmedClassification = await runCli(
    configDirectory,
    [
      "api",
      "POST",
      "/api/applications/app-1/communications/classify",
      "--data",
      classificationBody,
      "--idempotency-key",
      "classification-cli-1",
      "--json",
    ],
    1,
  );
  assert.match(unconfirmedClassification.stderr, /CONFIRMATION_REQUIRED/);
  const classified = JSON.parse(
    (
      await runCli(configDirectory, [
        "api",
        "POST",
        "/api/applications/app-1/communications/classify",
        "--data",
        classificationBody,
        "--idempotency-key",
        "classification-cli-1",
        "--confirm",
        "--json",
      ])
    ).stdout,
  );
  assert.deepEqual(classified.data.updatedIds, ["communication-1"]);
  assert.deepEqual(state.communicationClassificationRequests.at(-1), {
    body: JSON.parse(classificationBody),
    idempotencyKey: "classification-cli-1",
  });
  const categorized = JSON.parse(
    (
      await runCli(configDirectory, [
        "api",
        "PATCH",
        "/api/applications/app-1/communications/categories",
        "--data",
        JSON.stringify({
          communicationIds: ["communication-1"],
          category: "interview_invite",
        }),
        "--idempotency-key",
        "category-cli-1",
        "--json",
      ])
    ).stdout,
  );
  assert.deepEqual(categorized.data.updatedIds, ["communication-1"]);
  assert.equal(
    state.communicationCategoryRequests.at(-1).idempotencyKey,
    "category-cli-1",
  );
  const acknowledgedSettings = JSON.parse(
    (
      await runCli(configDirectory, [
        "api",
        "PATCH",
        "/api/settings",
        "--data",
        JSON.stringify({ language: "fr" }),
        "--json",
      ])
    ).stdout,
  );
  assert.equal(
    acknowledgedSettings.acknowledgement.protocol,
    "phd-atlas-settings-ack-v1",
  );
  assert.equal(acknowledgedSettings.acknowledgement.durable, true);
  assert.equal(acknowledgedSettings.data.settings.language, "fr");
  assert.equal(state.settingsAcknowledgementRequests.length, 1);
  const acknowledgedSecretSettings = JSON.parse(
    (
      await runCli(
        configDirectory,
        [
          "api",
          "PATCH",
          "/api/settings",
          "--data-file",
          "-",
          "--confirm",
          "--json",
        ],
        0,
        JSON.stringify({ smtpPass: "write-only-test-secret" }),
      )
    ).stdout,
  );
  assert.equal(
    acknowledgedSecretSettings.acknowledgement.secretReceipts,
    "[REDACTED]",
  );
  assert.doesNotMatch(
    JSON.stringify(acknowledgedSecretSettings),
    /write-only-test-secret/,
  );
  state.malformedNextSettingsAcknowledgement = true;
  const rejectedSettingsAcknowledgement = await runCli(
    configDirectory,
    [
      "api",
      "PATCH",
      "/api/settings",
      "--data",
      JSON.stringify({ highContrast: true }),
      "--json",
    ],
    1,
  );
  assert.match(
    rejectedSettingsAcknowledgement.stderr,
    /SETTINGS_WRITE_NOT_ACKNOWLEDGED/,
  );
  for (const forbiddenBusinessPath of [
    "/api/workspace/bootstrap/stream",
  ]) {
    const forbiddenBusiness = await runCli(
      configDirectory,
      ["api", "GET", forbiddenBusinessPath, "--json"],
      1,
    );
    assert.match(forbiddenBusiness.stderr, /FORBIDDEN_API_PATH/);
  }
  const interviewWorkspace = await runCli(
    configDirectory,
    ["api", "GET", "/api/interview-prep/workspace?subjectUserId=user-1", "--json"],
    0,
  );
  assert.equal(
    JSON.parse(interviewWorkspace.stdout).data.revision,
    0,
  );
  const sensitiveSettingsWithoutConfirmation = await runCli(
    configDirectory,
    [
      "api",
      "PATCH",
      "/api/settings",
      "--data",
      "{\"sendFrom\":\"verified@example.test\"}",
      "--json",
    ],
    1,
  );
  assert.match(
    sensitiveSettingsWithoutConfirmation.stderr,
    /CONFIRMATION_REQUIRED/,
  );
  const teamVisibilityDenied = await runCli(
    configDirectory,
    [
      "api",
      "PATCH",
      "/api/applications/app-1/team-visibility",
      "--data",
      "{\"visible\":true}",
      "--json",
    ],
    1,
  );
  assert.match(
    teamVisibilityDenied.stderr,
    /CAPABILITY_DENIED/,
  );

  const sensitiveInput = JSON.stringify({
    provider: "openai",
    label: "Primary",
    apiKey: "provider-key-must-not-leak",
  });
  const sensitiveArgv = await runCli(
    configDirectory,
    [
      "api",
      "POST",
      "/api/ai/keys",
      "--data",
      sensitiveInput,
      "--confirm",
      "--json",
    ],
    1,
  );
  assert.match(sensitiveArgv.stderr, /SENSITIVE_INPUT_SOURCE_REQUIRED/);
  assert.ok(!sensitiveArgv.stderr.includes("provider-key-must-not-leak"));
  assert.ok(!sensitiveArgv.stdout.includes("provider-key-must-not-leak"));

  const sensitiveDataFile = path.join(configDirectory, "sensitive-input.json");
  await fs.writeFile(sensitiveDataFile, sensitiveInput);
  const sensitiveFileResult = await runCli(
    configDirectory,
    [
      "api",
      "POST",
      "/api/ai/keys",
      "--data-file",
      sensitiveDataFile,
      "--confirm",
      "--json",
    ],
    1,
  );
  assert.match(sensitiveFileResult.stderr, /SENSITIVE_INPUT_SOURCE_REQUIRED/);

  const sensitiveStdin = await runCli(
    configDirectory,
    [
      "api",
      "POST",
      "/api/ai/keys",
      "--data-file",
      "-",
      "--confirm",
      "--json",
    ],
    0,
    sensitiveInput,
  );
  assert.equal(JSON.parse(sensitiveStdin.stdout).data.configured, true);
  assert.ok(!sensitiveStdin.stdout.includes("provider-key-must-not-leak"));
  assert.ok(!sensitiveStdin.stderr.includes("provider-key-must-not-leak"));
  const shortSensitiveStdin = await runCli(
    configDirectory,
    [
      "api",
      "POST",
      "/api/ai/keys",
      "--data-file",
      "-",
      "--confirm",
      "--json",
    ],
    1,
    JSON.stringify({ provider: "error", apiKey: "k7!" }),
  );
  assert.ok(!shortSensitiveStdin.stdout.includes("k7!"));
  assert.ok(!shortSensitiveStdin.stderr.includes("k7!"));
  assert.match(
    shortSensitiveStdin.stdout + shortSensitiveStdin.stderr,
    /\[REDACTED\]/,
  );
  const mcpSecurityBoundary = await runMcp(configDirectory, [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: mcpInitializeParams,
    },
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "phd_atlas_api",
        arguments: {
          account: first.id,
          method: "PATCH",
          path: "/api/teams/team-1",
          data: {
            permissionDefaults: {
              teacher: { canEditStudentApplications: true },
            },
          },
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "phd_atlas_api",
        arguments: {
          account: first.id,
          method: "POST",
          path: "/api/ai/keys",
          data: { provider: "error", apiKey: "q8!" },
          confirm: true,
        },
      },
    },
  ]);
  assertMcpToolError(
    mcpSecurityBoundary.lines[1],
    "FORBIDDEN_API_PATH",
  );
  const mcpRedactedProviderError = assertMcpToolError(
    mcpSecurityBoundary.lines[2],
    "PROVIDER_REJECTED",
  );
  assert.ok(!mcpSecurityBoundary.stdout.includes("q8!"));
  assert.ok(!mcpSecurityBoundary.stderr.includes("q8!"));
  assert.match(mcpRedactedProviderError, /\[REDACTED\]/);
  const passthrough = await runCli(
    configDirectory,
    [
      "api",
      "PATCH",
      "/api/applications/app-1",
      "--data",
      "{\"accessToken\":\"not-an-api-payload\"}",
      "--json",
    ],
    1,
  );
  assert.match(passthrough.stderr, /TOKEN_PASSTHROUGH_REFUSED/);
  const embeddedPassthrough = await runCli(
    configDirectory,
    [
      "api",
      "PATCH",
      "/api/applications/app-1",
      "--data",
      JSON.stringify({ notes: "prefix " + mockAccessToken(1) + " suffix" }),
      "--json",
    ],
    1,
  );
  assert.match(embeddedPassthrough.stderr, /TOKEN_PASSTHROUGH_REFUSED/);

  const encodedShareWithoutConfirmation = await runCli(
    configDirectory,
    ["api", "POST", "/api/applications/app-1/%73hare", "--data", "{}", "--json"],
    1,
  );
  assert.match(encodedShareWithoutConfirmation.stderr, /CONFIRMATION_REQUIRED/);

  const leak = await runCli(
    configDirectory,
    ["api", "GET", "/api/applications/leak", "--json"],
    1,
  );
  assert.ok(!leak.stderr.includes(mockAccessToken(1)));
  assert.match(leak.stderr, /\[REDACTED\]/);
  const redirect = await runCli(
    configDirectory,
    [
      "api",
      "GET",
      "/api/applications/cross-origin-redirect",
      "--json",
    ],
    1,
  );
  assert.match(redirect.stderr, /CROSS_ORIGIN_REDIRECT/);
  const sameOriginRedirect = await runCli(
    configDirectory,
    [
      "api",
      "GET",
      "/api/applications/same-origin-redirect",
      "--json",
    ],
    1,
  );
  assert.match(sameOriginRedirect.stderr, /API_REDIRECT_REFUSED/);
  const shareResult = await runCli(configDirectory, [
    "api",
    "GET",
    "/api/applications/share-result",
    "--json",
  ]);
  assert.ok(!shareResult.stdout.includes("public-share-token-never-print"));
  assert.ok(!shareResult.stdout.includes("provider-secret-never-print"));
  assert.ok(!shareResult.stdout.includes("smtp-secret-never-print"));
  assert.ok(!shareResult.stdout.includes("fragment-secret-never-print"));
  assert.match(shareResult.stdout, /\[REDACTED\]/);

  const defaultShareCreate = await runCli(configDirectory, [
    "api",
    "POST",
    "/api/applications/app-1/share",
    "--data",
    "{\"permission\":\"view\"}",
    "--confirm",
    "--json",
  ]);
  assert.ok(!defaultShareCreate.stdout.includes("created-share-token-1"));
  assert.match(defaultShareCreate.stdout, /\[REDACTED\]/);

  const revealedShareCreate = await runCli(configDirectory, [
    "api",
    "POST",
    "/api/applications/app-1/share",
    "--data",
    "{\"permission\":\"view\"}",
    "--confirm",
    "--reveal-created-link",
    "--json",
  ]);
  const revealedShare = JSON.parse(revealedShareCreate.stdout);
  assert.equal(
    revealedShare.oneTimeCreatedLink,
    state.origin + "/share/created-share-token-2",
  );
  assert.equal(
    revealedShareCreate.stdout.split("created-share-token-2").length - 1,
    1,
  );
  assert.equal(revealedShare.data.token, "[REDACTED]");
  assert.match(revealedShare.data.url, /\[REDACTED\]/);

  const refusedCredentialEcho = await runCli(configDirectory, [
    "api",
    "POST",
    "/api/applications/app-1/share/share-1/rotate",
    "--data",
    "{}",
    "--confirm",
    "--reveal-created-link",
    "--json",
  ]);
  assert.ok(!refusedCredentialEcho.stdout.includes(mockAccessToken(1)));
  assert.ok(
    Object.prototype.hasOwnProperty.call(
      JSON.parse(refusedCredentialEcho.stdout),
      "oneTimeCreatedLinkUnavailable",
    ),
  );

  const invalidReveal = await runCli(
    configDirectory,
    [
      "api",
      "POST",
      "/api/applications/app-1",
      "--data",
      "{}",
      "--confirm",
      "--reveal-created-link",
      "--json",
    ],
    1,
  );
  assert.match(invalidReveal.stderr, /CREATED_LINK_REVEAL_REFUSED/);

  const uploadSource = path.join(transferDirectory, "sample.txt");
  await fs.writeFile(uploadSource, "upload-body");
  const outsideUploadSource = path.join(
    outsideTransferDirectory,
    "outside-sample.txt",
  );
  await fs.writeFile(outsideUploadSource, "outside-upload-body");
  state.omitFilesReadFromCapabilities = true;
  state.omitFilesWriteFromCapabilities = true;
  await syncStoredMockScopes(configDirectory, first.id, state);
  const multipartExistingAttachmentWithoutScope = await runCli(
    configDirectory,
    [
      "upload",
      "/api/applications/app-1/communications/send",
      uploadSource,
      "--field",
      "files",
      "--form",
      "payload=" + JSON.stringify({
        subject: "Mixed attachments",
        attachments: [
          { uploadIndex: 0, fileName: "sample.txt" },
          { fileId: "file-3", fileName: "existing.pdf" },
        ],
      }),
      "--confirm",
      "--json",
    ],
    1,
  );
  assert.match(
    multipartExistingAttachmentWithoutScope.stderr,
    /CONDITIONAL_SCOPE_REQUIRED/,
  );
  assert.equal(state.communicationSendCalls, 2);

  const malformedMultipartPayload = await runCli(
    configDirectory,
    [
      "upload",
      "/api/applications/app-1/communications/send",
      uploadSource,
      "--field",
      "files",
      "--form",
      'payload={"attachments":[{"fileId":"file-hidden"}]',
      "--confirm",
      "--json",
    ],
    1,
  );
  assert.match(malformedMultipartPayload.stderr, /CONDITIONAL_INPUT_INVALID/);
  assert.equal(state.communicationSendCalls, 2);

  const localMultipartAttachment = JSON.parse(
    (
      await runCli(configDirectory, [
        "upload",
        "/api/applications/app-1/communications/send",
        uploadSource,
        "--field",
        "files",
        "--form",
        "payload=" + JSON.stringify({
          subject: "Local attachment",
          attachments: [{ uploadIndex: 0, fileName: "sample.txt" }],
        }),
        "--confirm",
        "--json",
      ])
    ).stdout,
  );
  assert.equal(localMultipartAttachment.data.sent, true);
  assert.equal(state.communicationSendCalls, 3);
  state.omitFilesReadFromCapabilities = false;
  state.omitFilesWriteFromCapabilities = false;
  await syncStoredMockScopes(configDirectory, first.id, state);

  const upload = JSON.parse(
    (
      await runCli(configDirectory, [
        "upload",
        "/api/applications/app-1/files",
        uploadSource,
        "--json",
      ])
    ).stdout,
  );
  assert.equal(upload.data.uploaded, true);
  assert.ok(state.uploadBytes > 0);

  const downloadTarget = path.join(transferDirectory, "export.bin");
  const download = JSON.parse(
    (
      await runCli(configDirectory, [
        "download",
        "/api/applications/app-1/export",
        "--output",
        downloadTarget,
        "--json",
      ])
    ).stdout,
  );
  assert.equal(download.downloaded.bytes, 21);
  assert.equal(await fs.readFile(downloadTarget, "utf8"), "binary-export-content");

  const symlinkBackingFile = path.join(transferDirectory, "symlink-backing.bin");
  const symlinkDownloadTarget = path.join(
    transferDirectory,
    "symlink-download.bin",
  );
  await fs.writeFile(symlinkBackingFile, "must-not-change");
  if (await tryCreateFileSymlink(symlinkBackingFile, symlinkDownloadTarget)) {
    const symlinkDownload = await runCli(
      configDirectory,
      [
        "download",
        "/api/applications/app-1/export",
        "--output",
        symlinkDownloadTarget,
        "--force",
        "--confirm",
        "--json",
      ],
      1,
    );
    assert.match(symlinkDownload.stderr, /INVALID_FILE/);
    assert.equal(await fs.readFile(symlinkBackingFile, "utf8"), "must-not-change");
    await fs.unlink(symlinkDownloadTarget);
  }

  state.nextDeviceMode = "wait_for_cancel";
  const cancellableLogin = JSON.parse(
    (
      await runCli(configDirectory, [
        "login",
        "start",
        "--server",
        state.origin,
        "--name",
        "Cancelled MCP login",
        "--json",
      ])
    ).stdout,
  );
  const cancelledMcp = await runMcp(configDirectory, [
    {
      jsonrpc: "2.0",
      id: "cancel-init",
      method: "initialize",
      params: mcpInitializeParams,
    },
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    },
    {
      jsonrpc: "2.0",
      id: "cancel-tool",
      method: "tools/call",
      params: {
        name: "phd_atlas_login_finish",
        arguments: { login_id: cancellableLogin.loginId, wait: true },
      },
    },
    {
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: "cancel-tool", reason: "test cancellation" },
    },
  ], "cancellation MCP");
  assert.equal(cancelledMcp.lines.length, 2);
  assertMcpToolError(cancelledMcp.lines[1], "REQUEST_CANCELLED");
  assert.equal(cancelledMcp.stderr, "");
  await discardMockPendingLogin(configDirectory, cancellableLogin.loginId);

  state.nextDeviceMode = "wait_for_cancel";
  const eofCancellableLogin = JSON.parse(
    (
      await runCli(configDirectory, [
        "login",
        "start",
        "--server",
        state.origin,
        "--name",
        "EOF-cancelled MCP login",
        "--json",
      ])
    ).stdout,
  );
  const eofCancellationStartedAt = Date.now();
  const eofCancelledMcp = await runMcp(
    configDirectory,
    [
      {
        jsonrpc: "2.0",
        id: "eof-init",
        method: "initialize",
        params: mcpInitializeParams,
      },
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      },
      {
        jsonrpc: "2.0",
        id: "eof-waiting-tool",
        method: "tools/call",
        params: {
          name: "phd_atlas_login_finish",
          arguments: { login_id: eofCancellableLogin.loginId, wait: true },
        },
      },
    ],
    "EOF cancellation MCP",
    { closeInputImmediately: true },
  );
  assert.equal(eofCancelledMcp.lines.length, 2);
  assertMcpToolError(eofCancelledMcp.lines[1], "REQUEST_CANCELLED");
  assert.ok(
    Date.now() - eofCancellationStartedAt < 5_000,
    "EOF must abort a waiting MCP request instead of waiting for remote polling",
  );
  assert.equal(eofCancelledMcp.stderr, "");
  await discardMockPendingLogin(configDirectory, eofCancellableLogin.loginId);

  const growingUploadSource = path.join(
    transferDirectory,
    "growing-mcp-upload.bin",
  );
  const initialGrowingUpload = Buffer.alloc(64 * 1024, 0x61);
  const concurrentGrowthMarker = Buffer.from(
    "MCP-CONCURRENT-GROWTH-MUST-NOT-BE-UPLOADED",
  );
  await fs.writeFile(growingUploadSource, initialGrowingUpload);
  const uploadRequestGate = {
    reached: createDeferred(),
    release: createDeferred(),
  };
  state.nextUploadRequestGate = uploadRequestGate;
  const uploadRequestsBeforeGrowth = state.uploadRequests;
  const growingUploadMcpPromise = runMcp(
    configDirectory,
    [
      {
        jsonrpc: "2.0",
        id: "growth-init",
        method: "initialize",
        params: mcpInitializeParams,
      },
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      },
      {
        jsonrpc: "2.0",
        id: "growth-upload",
        method: "tools/call",
        params: {
          name: "phd_atlas_upload",
          arguments: {
            account: first.id,
            path: "/api/applications/app-1/files",
            file: growingUploadSource,
            confirm: true,
          },
        },
      },
    ],
    "concurrently growing upload MCP",
  );
  let uploadGateError;
  try {
    await Promise.race([
      uploadRequestGate.reached.promise,
      new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("MCP upload did not reach the mock server")),
          5_000,
        );
        timer.unref();
      }),
    ]);
    await fs.appendFile(growingUploadSource, concurrentGrowthMarker);
  } catch (error) {
    uploadGateError = error;
  } finally {
    uploadRequestGate.release.resolve();
  }
  const growingUploadMcp = await growingUploadMcpPromise;
  if (uploadGateError) {
    throw uploadGateError;
  }
  assert.equal(growingUploadMcp.lines.length, 2);
  assert.equal(
    growingUploadMcp.lines[1].result.structuredContent.uploaded.bytes,
    initialGrowingUpload.length,
  );
  assert.equal(state.uploadRequests, uploadRequestsBeforeGrowth + 1);
  assert.equal(
    state.lastUploadBody.includes(concurrentGrowthMarker),
    false,
    "an upload must remain bounded to the source size captured before transfer",
  );
  assert.equal(
    (await fs.stat(growingUploadSource)).size,
    initialGrowingUpload.length + concurrentGrowthMarker.length,
  );
  assert.equal(growingUploadMcp.stderr, "");
  state.lastUploadBody = null;

  const mcpDownloadTarget = path.join(transferDirectory, "mcp-export.bin");
  const outsideMcpDownloadTarget = path.join(
    outsideTransferDirectory,
    "mcp-export.bin",
  );

  const mcp = await runMcp(configDirectory, [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: mcpInitializeParams,
    },
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "ping", params: {} },
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "phd_atlas_status",
        arguments: { account: first.id },
      },
    },
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "phd_atlas_api",
        arguments: {
          account: first.id,
          method: "GET",
          path: "/api/applications",
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "phd_atlas_api",
        arguments: {
          account: first.id,
          method: "POST",
          path: "/api/applications/app-1/share",
          data: { permission: "view" },
          confirm: true,
          revealCreatedLink: true,
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "phd_atlas_api",
        arguments: {
          account: first.id,
          method: "DELETE",
          path: "/api/applications/app-1",
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "phd_atlas_logout",
        arguments: { account: first.id },
      },
    },
    {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "phd_atlas_api",
        arguments: {
          account: first.id,
          method: "POST",
          path: "/api/ai/keys",
          data: {
            provider: "openai",
            label: "MCP",
            apiKey: "mcp-provider-key-must-not-leak",
          },
          confirm: true,
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "phd_atlas_api",
        arguments: {
          account: first.id,
          method: "POST",
          path: "/api/ai/keys",
          data: {
            provider: "error",
            apiKey: "mcp-error-key-must-not-leak",
          },
          confirm: true,
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "phd_atlas_login_start",
        arguments: { server: state.origin, expires_in_days: 31 },
      },
    },
    {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        name: "phd_atlas_login_start",
        arguments: { server: state.origin, scopes: [] },
      },
    },
    {
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: {
        name: "phd_atlas_applications_list",
        arguments: { account: first.id },
      },
    },
    {
      jsonrpc: "2.0",
      id: 14,
      method: "tools/call",
      params: {
        name: "phd_atlas_application_get",
        arguments: { account: first.id, application_id: "app-1" },
      },
    },
    {
      jsonrpc: "2.0",
      id: 15,
      method: "tools/call",
      params: {
        name: "phd_atlas_application_update",
        arguments: {
          account: first.id,
          application_id: "app-1",
          confirm: true,
          changes: {
            deadline: "2027-01-15",
            notes: { draft: "updated through focused MCP tool" },
          },
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 16,
      method: "tools/call",
      params: {
        name: "phd_atlas_application_checklist",
        arguments: {
          account: first.id,
          action: "read",
          application_id: "app-1",
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 17,
      method: "tools/call",
      params: {
        name: "phd_atlas_profile_recommenders",
        arguments: { account: first.id, action: "list" },
      },
    },
    {
      jsonrpc: "2.0",
      id: 18,
      method: "tools/call",
      params: {
        name: "phd_atlas_communications",
        arguments: {
          account: first.id,
          action: "list",
          application_id: "app-1",
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 19,
      method: "tools/call",
      params: {
        name: "phd_atlas_application_create",
        arguments: {
          account: first.id,
          application: { program: "Unsafe Team target", teamId: "team-1" },
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "phd_atlas_application_update",
        arguments: {
          account: first.id,
          application_id: "app-1",
          confirm: true,
          changes: { ownerId: "different-user" },
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: {
        name: "phd_atlas_team_students",
        arguments: {
          account: first.id,
          action: "remove_member",
          team_id: "team-1",
          confirm: true,
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: {
        name: "phd_atlas_profile_assets",
        arguments: {
          account: first.id,
          action: "list",
          team_id: "team-1",
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 23,
      method: "tools/call",
      params: {
        name: "phd_atlas_communications",
        arguments: {
          account: first.id,
          action: "send",
          application_id: "app-1",
          data: {
            to: "student@example.test",
            subject: "Confirmed target required",
            body: "Body",
            idempotencyKey: "mcp-send-1",
          },
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 24,
      method: "tools/call",
      params: {
        name: "phd_atlas_api",
        arguments: {
          method: "POST",
          path: "/api/applications",
          data: { program: "Ambiguous account write" },
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 25,
      method: "tools/call",
      params: {
        name: "phd_atlas_application_update",
        arguments: {
          application_id: "app-1",
          confirm: true,
          changes: { deadline: "2027-02-01" },
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 26,
      method: "tools/call",
      params: {
        name: "phd_atlas_upload",
        arguments: {
          account: first.id,
          path: "/api/applications/app-1/files",
          file: uploadSource,
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 27,
      method: "tools/call",
      params: {
        name: "phd_atlas_upload",
        arguments: {
          account: first.id,
          path: "/api/applications/app-1/files",
          file: uploadSource,
          confirm: true,
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 28,
      method: "tools/call",
      params: {
        name: "phd_atlas_upload",
        arguments: {
          account: first.id,
          path: "/api/applications/app-1/files",
          file: outsideUploadSource,
          confirm: true,
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 29,
      method: "tools/call",
      params: {
        name: "phd_atlas_download",
        arguments: {
          account: first.id,
          path: "/api/applications/app-1/export",
          output: mcpDownloadTarget,
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: {
        name: "phd_atlas_download",
        arguments: {
          account: first.id,
          path: "/api/applications/app-1/export",
          output: mcpDownloadTarget,
          confirm: true,
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "phd_atlas_download",
        arguments: {
          account: first.id,
          path: "/api/applications/app-1/export",
          output: outsideMcpDownloadTarget,
          confirm: true,
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: {
        name: "phd_atlas_application_create",
        arguments: {
          account: first.id,
          application: {
            professor: "Professor Truth",
            professorEmail: "truth@example.test",
            university: "Truth University",
            country: "GB",
            program: "Verified Personal PhD",
            deadline: "2027-09-30",
            notes: "Exact persisted notes",
          },
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 33,
      method: "tools/call",
      params: {
        name: "phd_atlas_application_create",
        arguments: {
          account: first.id,
          application: {
            professor: "Professor Team",
            professorEmail: "team@example.test",
            university: "Team University",
            country: "US",
            program: "Verified Team PhD",
            deadline: "2027-10-31",
            visibleToTeam: true,
            ownerId: "student-1",
            teamId: "team-1",
          },
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 34,
      method: "tools/call",
      params: {
        name: "phd_atlas_application_create",
        arguments: {
          account: first.id,
          application: {
            professor: "Professor Tampered",
            professorEmail: "tampered@example.test",
            university: "Tampered University",
            country: "CA",
            program: "Tampered Receipt PhD",
            deadline: "2027-11-30",
          },
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 35,
      method: "tools/call",
      params: {
        name: "phd_atlas_communications",
        arguments: {
          account: first.id,
          action: "classify",
          application_id: "app-1",
          idempotency_key: "classification-mcp-1",
          data: {
            communicationIds: ["communication-1"],
            keyId: "key-1",
          },
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 36,
      method: "tools/call",
      params: {
        name: "phd_atlas_communications",
        arguments: {
          account: first.id,
          action: "classify",
          application_id: "app-1",
          idempotency_key: "classification-mcp-1",
          confirm: true,
          data: {
            communicationIds: ["communication-1"],
            keyId: "key-1",
          },
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 37,
      method: "tools/call",
      params: {
        name: "phd_atlas_communications",
        arguments: {
          account: first.id,
          action: "categorize",
          application_id: "app-1",
          idempotency_key: "category-mcp-1",
          data: {
            communicationIds: ["communication-1"],
            category: "interview_invite",
          },
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 38,
      method: "tools/call",
      params: {
        name: "phd_atlas_communications",
        arguments: {
          account: first.id,
          action: "update",
          application_id: "app-1",
          communication_id: "communication-1",
          data: { mailCategoryOverride: "rejection" },
        },
      },
    },
  ], "business MCP");
  assert.equal(mcp.lines.length, 38);
  assert.equal(mcp.lines[0].result.serverInfo.name, "phd-atlas");
  assert.ok(
    mcp.lines[1].result.tools.some(
      (tool) => tool.name === "phd_atlas_api",
    ),
  );
  assert.deepEqual(mcp.lines[2].result, {});
  assert.equal(
    mcp.lines[3].result.structuredContent.identity.user.id,
    "user-1",
  );
  assert.equal(
    mcp.lines[4].result.structuredContent.data[0].owner,
    "user-1",
  );
  const mcpShare = mcp.lines[5].result;
  assert.match(mcpShare.content[0].text, /one-time value/);
  assert.equal(
    mcpShare.structuredContent.oneTimeCreatedLink,
    state.origin + "/share/created-share-token-3",
  );
  assert.equal(
    JSON.stringify(mcpShare).split("created-share-token-3").length - 1,
    1,
  );
  assert.equal(mcpShare.structuredContent.data.token, "[REDACTED]");
  assertMcpToolError(mcp.lines[6], "CONFIRMATION_REQUIRED");
  assertMcpProtocolError(mcp.lines[7], -32602, "INVALID_ARGUMENT");
  assert.equal(mcp.lines[8].result.structuredContent.data.configured, true);
  assert.ok(!mcp.stdout.includes("mcp-provider-key-must-not-leak"));
  assert.ok(!mcp.stderr.includes("mcp-provider-key-must-not-leak"));
  assert.match(
    assertMcpToolError(mcp.lines[9], "PROVIDER_REJECTED"),
    /\[REDACTED\]/,
  );
  assert.ok(!mcp.stdout.includes("mcp-error-key-must-not-leak"));
  assertMcpProtocolError(mcp.lines[10], -32602, "INVALID_ARGUMENT");
  assertMcpToolError(mcp.lines[11], "INVALID_SCOPE");
  assert.equal(
    mcp.lines[12].result.structuredContent.data[0].owner,
    "user-1",
  );
  assert.equal(
    mcp.lines[13].result.structuredContent.data.program,
    "Computer Science PhD",
  );
  const focusedUpdate = mcp.lines[14].result;
  assert.equal(focusedUpdate.isError, undefined);
  assert.deepEqual(focusedUpdate.structuredContent.changedFields, [
    "deadline",
    "notes",
  ]);
  assert.equal(
    focusedUpdate.structuredContent.verification,
    "canonical_readback_acknowledged",
  );
  assert.equal(focusedUpdate.structuredContent.data.deadline, "2027-01-15");
  assert.equal(
    focusedUpdate.structuredContent.data.notes.draft,
    "updated through focused MCP tool",
  );
  assert.equal(
    focusedUpdate.structuredContent.data.notes.serverOwnedMarker,
    "preserve-me",
  );
  assert.deepEqual(
    JSON.parse(focusedUpdate.content[0].text),
    focusedUpdate.structuredContent,
  );
  assert.equal(state.applicationPuts.length, 1);
  assert.equal(state.applicationPuts[0].ownerId, "user-1");
  assert.equal(state.applicationPuts[0].teamId, null);

  for (const focusedCreate of [mcp.lines[31].result]) {
    assert.equal(focusedCreate.isError, undefined);
    assert.equal(
      focusedCreate.structuredContent.verification,
      "canonical_readback_acknowledged",
    );
    assert.equal(
      focusedCreate.structuredContent.acknowledgement.protocol,
      "phd-atlas-application-mutation-ack-v2",
    );
    assert.equal(
      focusedCreate.structuredContent.acknowledgement.authorityPurpose,
      "create",
    );
    assert.equal(focusedCreate.structuredContent.acknowledgement.durable, true);
  }
  assert.equal(
    mcp.lines[31].result.structuredContent.data.result,
    "Exact persisted notes",
  );
  assert.match(
    assertMcpToolError(mcp.lines[32], "INVALID_ARGUMENT"),
    /personal applications only/i,
  );
  assertMcpToolError(mcp.lines[33], "WRITE_NOT_ACKNOWLEDGED");
  assertMcpToolError(mcp.lines[34], "CONFIRMATION_REQUIRED");
  assert.deepEqual(
    mcp.lines[35].result.structuredContent.data.updatedIds,
    ["communication-1"],
  );
  assert.deepEqual(
    mcp.lines[36].result.structuredContent.data.updatedIds,
    ["communication-1"],
  );
  assert.equal(
    state.communicationClassificationRequests.at(-1).idempotencyKey,
    "classification-mcp-1",
  );
  assert.equal(
    state.communicationCategoryRequests.at(-1).idempotencyKey,
    "category-mcp-1",
  );
  assertMcpToolError(mcp.lines[37], "DEDICATED_OPERATION_REQUIRED");
  assert.deepEqual(state.createdApplicationReads.sort(), [
    "created-personal",
    "created-tampered",
  ]);
  assert.equal(state.applicationCreatePosts.length, 2);

  const focusedChecklist = mcp.lines[15].result.structuredContent.data;
  assert.equal(focusedChecklist.applicationId, "app-1");
  assert.ok(
    ["2026-11-30", "2027-01-15"].includes(focusedChecklist.deadline),
    "concurrent checklist read must return a complete canonical snapshot",
  );
  assert.deepEqual(focusedChecklist.tasks, [
    { id: "task-1", title: "Ask recommender" },
  ]);
  assert.equal(
    mcp.lines[16].result.structuredContent.data[0].name,
    "Professor Example",
  );
  assert.equal(
    mcp.lines[17].result.structuredContent.data.communications[0].id,
    "communication-1",
  );
  assert.match(
    assertMcpToolError(mcp.lines[18], "INVALID_ARGUMENT"),
    /personal applications only/i,
  );
  assertMcpToolError(mcp.lines[19], "IMMUTABLE_TARGET");
  assertMcpProtocolError(mcp.lines[20], -32602);
  assertMcpProtocolError(mcp.lines[21], -32602);
  assert.match(
    assertMcpToolError(mcp.lines[22], "CONFIRMATION_REQUIRED"),
    /explicit confirmation/i,
  );
  for (const accountlessWrite of [mcp.lines[23], mcp.lines[24]]) {
    const accountlessWriteError = assertMcpProtocolError(
      accountlessWrite,
      -32602,
      "INVALID_ARGUMENT",
    );
    assert.match(accountlessWriteError.data?.message || "", /account.*required/i);
  }
  assertMcpToolError(mcp.lines[25], "CONFIRMATION_REQUIRED");
  assert.equal(mcp.lines[26].result.structuredContent.data.uploaded, true);
  assertMcpToolError(mcp.lines[27], "LOCAL_PATH_NOT_ALLOWED");
  assertMcpToolError(mcp.lines[28], "CONFIRMATION_REQUIRED");
  assert.equal(mcp.lines[29].result.structuredContent.downloaded.bytes, 21);
  assert.equal(
    await fs.readFile(mcpDownloadTarget, "utf8"),
    "binary-export-content",
  );
  assertMcpToolError(mcp.lines[30], "LOCAL_PATH_NOT_ALLOWED");
  await assert.rejects(fs.stat(outsideMcpDownloadTarget), { code: "ENOENT" });
  assert.equal(state.communicationSendCalls, 3);
  assert.equal(state.applicationPuts.length, 1);
  assert.equal(mcp.stderr, "");

  const diagnostics = JSON.parse(
    (
      await runCli(configDirectory, [
        "doctor",
        "--json",
      ])
    ).stdout,
  );
  assert.equal(diagnostics.status, "ok");
  assert.ok(!JSON.stringify(diagnostics).includes(mockAccessToken(1)));
  assert.ok(!JSON.stringify(diagnostics).includes(mockAccessToken(2)));

  const configPath = path.join(configDirectory, "config.json");
  const forbiddenCredentialUpload = await runCli(
    configDirectory,
    [
      "upload",
      "/api/applications/app-1/files",
      configPath,
      "--json",
    ],
    1,
  );
  assert.match(forbiddenCredentialUpload.stderr, /CREDENTIAL_FILE_FORBIDDEN/);
  const forbiddenCredentialDownload = await runCli(
    configDirectory,
    [
      "download",
      "/api/applications/app-1/export",
      "--output",
      configPath,
      "--force",
      "--confirm",
      "--json",
    ],
    1,
  );
  assert.match(forbiddenCredentialDownload.stderr, /CREDENTIAL_FILE_FORBIDDEN/);
  const realConfigPath = path.join(configDirectory, "config.real.json");
  await fs.rename(configPath, realConfigPath);
  const configSymlinkCreated = await tryCreateFileSymlink(
    realConfigPath,
    configPath,
  );
  if (configSymlinkCreated) {
    const symlinkConfig = await runCli(
      configDirectory,
      ["accounts", "list", "--json"],
      1,
    );
    assert.match(symlinkConfig.stderr, /INSECURE_CONFIG_FILE/);
    await fs.unlink(configPath);
  }
  await fs.rename(realConfigPath, configPath);

  const canonicalConfig = await fs.readFile(configPath, "utf8");
  const unsafeConfig = JSON.parse(canonicalConfig);
  unsafeConfig.accounts[first.id].server = "http://example.test";
  await fs.writeFile(configPath, JSON.stringify(unsafeConfig));
  const unsafeStoredServer = await runCli(
    configDirectory,
    ["accounts", "list", "--json"],
    1,
  );
  assert.match(unsafeStoredServer.stderr, /INVALID_CONFIG/);
  await fs.writeFile(configPath, canonicalConfig);

  const swappedAccountConfig = JSON.parse(canonicalConfig);
  [
    swappedAccountConfig.accounts[first.id],
    swappedAccountConfig.accounts[second.id],
  ] = [
    swappedAccountConfig.accounts[second.id],
    swappedAccountConfig.accounts[first.id],
  ];
  await fs.writeFile(configPath, JSON.stringify(swappedAccountConfig));
  const swappedAccountKeys = await runCli(
    configDirectory,
    ["accounts", "list", "--json"],
    1,
  );
  assert.match(swappedAccountKeys.stderr, /INVALID_CONFIG/);
  await fs.writeFile(configPath, canonicalConfig);

  const firstPendingForKeySwap = JSON.parse(
    (
      await runCli(configDirectory, [
        "login",
        "start",
        "--server",
        state.origin,
        "--name",
        "Pending key swap one",
        "--json",
      ])
    ).stdout,
  );
  const secondPendingForKeySwap = JSON.parse(
    (
      await runCli(configDirectory, [
        "login",
        "start",
        "--server",
        state.origin,
        "--name",
        "Pending key swap two",
        "--json",
      ])
    ).stdout,
  );
  const pendingKeySwapConfig = JSON.parse(
    await fs.readFile(configPath, "utf8"),
  );
  [
    pendingKeySwapConfig.pendingLogins[firstPendingForKeySwap.loginId],
    pendingKeySwapConfig.pendingLogins[secondPendingForKeySwap.loginId],
  ] = [
    pendingKeySwapConfig.pendingLogins[secondPendingForKeySwap.loginId],
    pendingKeySwapConfig.pendingLogins[firstPendingForKeySwap.loginId],
  ];
  await fs.writeFile(configPath, JSON.stringify(pendingKeySwapConfig));
  const swappedPendingKeys = await runCli(
    configDirectory,
    ["accounts", "list", "--json"],
    1,
  );
  assert.match(swappedPendingKeys.stderr, /INVALID_CONFIG/);
  await fs.writeFile(configPath, canonicalConfig);

  const logoutWithoutConfirmation = await runCli(
    configDirectory,
    ["logout", "--account", second.id, "--json"],
    1,
  );
  assert.match(logoutWithoutConfirmation.stderr, /CONFIRMATION_REQUIRED/);

  state.failNextRevoke = true;
  const failedRemoteLogout = await runCli(
    configDirectory,
    ["logout", "--account", second.id, "--confirm", "--json"],
    1,
  );
  assert.equal(JSON.parse(failedRemoteLogout.stdout).status, "partial_failure");
  const configAfterFailedRevoke = await fs.readFile(
    path.join(configDirectory, "config.json"),
    "utf8",
  );
  assert.ok(configAfterFailedRevoke.includes(mockAccessToken(2)));

  await runCli(configDirectory, [
    "logout",
    "--account",
    second.id,
    "--local-only",
    "--confirm",
    "--json",
  ]);
  assert.equal(state.revokeCalls, 0);
  const configAfterLocalOnly = await fs.readFile(
    path.join(configDirectory, "config.json"),
    "utf8",
  );
  assert.ok(!configAfterLocalOnly.includes(mockAccessToken(2)));
  assert.ok(configAfterLocalOnly.includes(mockAccessToken(1)));

  await runCli(configDirectory, [
    "logout",
    "--account",
    first.id,
    "--confirm",
    "--json",
  ]);
  assert.equal(state.revokeCalls, 1);
  const finalConfig = await fs.readFile(
    path.join(configDirectory, "config.json"),
    "utf8",
  );
  assert.ok(!finalConfig.includes(mockAccessToken(1)));
  assert.ok(!finalConfig.includes(mockAccessToken(2)));
  if (process.platform !== "win32") {
    const mode = (await fs.stat(path.join(configDirectory, "config.json"))).mode;
    assert.equal(mode & 0o077, 0);
  }
});

test("CLI completes the real createApp OAuth device boundary", async (context) => {
  const configDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "phd-atlas-cli-real-boundary-"),
  );
  context.after(async () => {
    await fs.rm(configDirectory, { recursive: true, force: true });
  });

  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  let server;
  try {
    const serverModuleUrl = pathToFileURL(
      path.resolve(testDirectory, "../../../../../server/index.js"),
    ).href;
    const { createApp } = await import(
      serverModuleUrl + "?phd-atlas-cli-boundary=" + Date.now()
    );
    server = createApp().listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    const origin = "http://127.0.0.1:" + address.port;

    const started = JSON.parse(
      (
        await runCli(configDirectory, [
          "login",
          "start",
          "--server",
          origin,
          "--name",
          "Real boundary",
          "--scope",
          "applications:read",
          "--expires-in-days",
          "30",
          "--json",
        ])
      ).stdout,
    );
    assert.equal(started.status, "authorization_required");
    assert.equal(started.requestedScopes.length, 1);

    const pending = JSON.parse(
      (
        await runCli(
          configDirectory,
          ["login", "finish", started.loginId, "--json"],
          2,
        )
      ).stdout,
    );
    assert.equal(pending.status, "authorization_pending");

    const loginResponse = await fetch(origin + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "jasper@example.com",
        password: "demo123456",
      }),
    });
    const loginPayload = await loginResponse.json();
    assert.equal(loginResponse.status, 200, JSON.stringify(loginPayload));
    const sessionToken = loginPayload.data.token;

    const approveResponse = await fetch(
      origin +
        "/api/codex/device-authorizations/" +
        encodeURIComponent(started.userCode) +
        "/approve",
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + sessionToken,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    const approvePayload = await approveResponse.json();
    assert.equal(approveResponse.status, 200, JSON.stringify(approvePayload));

    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(5, pending.retryAfterSeconds) * 1_000),
    );
    const finished = JSON.parse(
      (
        await runCli(configDirectory, [
          "login",
          "finish",
          started.loginId,
          "--json",
        ])
      ).stdout,
    );
    assert.equal(finished.status, "connected");

    const identity = JSON.parse(
      (await runCli(configDirectory, ["whoami", "--json"])).stdout,
    );
    assert.equal(identity.identity.user.email, "jasper@example.com");

    const loggedOut = JSON.parse(
      (
        await runCli(configDirectory, ["logout", "--confirm", "--json"])
      ).stdout,
    );
    assert.equal(loggedOut.status, "logged_out");
    assert.equal(loggedOut.removed[0].remoteRevoked, true);
  } finally {
    if (server) {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});
