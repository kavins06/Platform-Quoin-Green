import { afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  NonRetryableIntegrationError,
  RetryableIntegrationError,
} from "@/server/lib/errors";
import {
  parseESPIXml,
  aggregateToMonthly,
} from "@/server/integrations/green-button/espi-parser";
import {
  getGreenButtonTokensForConnection,
  GREEN_BUTTON_TOKEN_ENCRYPTION_VERSION,
  resolveGreenButtonTokensFromRecord,
  type GreenButtonCredentialRecord,
} from "@/server/integrations/green-button/credentials";
import {
  openSecret,
  sealSecret,
} from "@/server/lib/crypto/secret-envelope";
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  generateState,
  refreshAccessToken,
  extractSubscriptionId,
} from "@/server/integrations/green-button/oauth";

const fixturesDir = join(__dirname, "../fixtures/green-button");

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── ESPI Parser ─────────────────────────────────────────────────────────────

describe("ESPI Parser", () => {
  it("parses electricity ESPI XML with 3 daily readings", () => {
    const xml = loadFixture("electric-daily.xml");
    const readings = parseESPIXml(xml);

    expect(readings).toHaveLength(3);
    expect(readings[0]!.fuelType).toBe("ELECTRIC");
    expect(readings[0]!.source).toBe("GREEN_BUTTON");
    // 450000 Wh = 450 kWh
    expect(readings[0]!.consumptionKWh).toBeCloseTo(450, 1);
    // 520000 Wh = 520 kWh
    expect(readings[1]!.consumptionKWh).toBeCloseTo(520, 1);
    // 380000 Wh = 380 kWh
    expect(readings[2]!.consumptionKWh).toBeCloseTo(380, 1);
  });

  it("handles powerOfTenMultiplier correctly", () => {
    // Multiplier=3 means value is in kWh (×10^3 Wh = kWh × 1000 Wh / 1000)
    // Actually multiplier scales the raw value: scaledValue = value × 10^multiplier
    // Then for uom=72 (Wh): kWh = scaledValue / 1000
    // So value=450, multiplier=3: scaledValue = 450 × 1000 = 450000 Wh = 450 kWh
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <content>
      <ReadingType xmlns="http://naesb.org/espi">
        <commodity>0</commodity>
        <uom>72</uom>
        <powerOfTenMultiplier>3</powerOfTenMultiplier>
      </ReadingType>
    </content>
  </entry>
  <entry>
    <content>
      <IntervalBlock xmlns="http://naesb.org/espi">
        <IntervalReading>
          <timePeriod><start>1736899200</start><duration>3600</duration></timePeriod>
          <value>450</value>
        </IntervalReading>
      </IntervalBlock>
    </content>
  </entry>
</feed>`;

    const readings = parseESPIXml(xml);
    expect(readings).toHaveLength(1);
    // 450 × 10^3 = 450000 Wh = 450 kWh
    expect(readings[0]!.consumptionKWh).toBeCloseTo(450, 1);
  });

  it("detects estimated readings (qualityOfReading=8)", () => {
    const xml = loadFixture("electric-daily.xml");
    const readings = parseESPIXml(xml);

    // First two are actual (quality=0)
    expect(readings[0]!.isEstimated).toBe(false);
    expect(readings[1]!.isEstimated).toBe(false);
    // Third is estimated (quality=8)
    expect(readings[2]!.isEstimated).toBe(true);
  });

  it("parses gas readings with therms (uom=169)", () => {
    const xml = loadFixture("gas-therms.xml");
    const readings = parseESPIXml(xml);

    expect(readings).toHaveLength(1);
    expect(readings[0]!.fuelType).toBe("GAS");
    // 15 therms × 29.3001 = 439.5015 kWh
    expect(readings[0]!.consumptionKWh).toBeCloseTo(439.5, 0);
  });

  it("converts kWh to kBtu correctly", () => {
    const xml = loadFixture("electric-daily.xml");
    const readings = parseESPIXml(xml);

    // 450 kWh × 3.412 = 1535.4 kBtu
    expect(readings[0]!.consumptionKBtu).toBeCloseTo(450 * 3.412, 0);
  });

  it("returns empty array for XML with no IntervalBlocks", () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <content>
      <ReadingType xmlns="http://naesb.org/espi">
        <commodity>0</commodity>
        <uom>72</uom>
      </ReadingType>
    </content>
  </entry>
</feed>`;

    const readings = parseESPIXml(xml);
    expect(readings).toHaveLength(0);
  });

  it("throws on invalid XML without feed element", () => {
    expect(() => parseESPIXml("<root><data/></root>")).toThrow(
      "Invalid ESPI XML payload: missing feed element.",
    );
  });

  it("sets correct period start and end from timePeriod", () => {
    const xml = loadFixture("electric-daily.xml");
    const readings = parseESPIXml(xml);

    // start=1736899200 → 2025-01-15T00:00:00Z, duration=86400 → +24h
    const r0 = readings[0]!;
    expect(r0.periodStart.toISOString()).toBe("2025-01-15T00:00:00.000Z");
    expect(r0.periodEnd.toISOString()).toBe("2025-01-16T00:00:00.000Z");
    expect(r0.intervalSeconds).toBe(86400);
  });
});

// ── Aggregation ─────────────────────────────────────────────────────────────

describe("aggregateToMonthly", () => {
  it("aggregates daily readings into monthly totals", () => {
    const xml = loadFixture("electric-daily.xml");
    const readings = parseESPIXml(xml);
    const monthly = aggregateToMonthly(readings);

    // All 3 readings are in Jan 2025
    expect(monthly).toHaveLength(1);
    expect(monthly[0]!.periodStart.toISOString()).toBe(
      "2025-01-01T00:00:00.000Z",
    );
    // 450 + 520 + 380 = 1350 kWh
    expect(monthly[0]!.consumptionKWh).toBeCloseTo(1350, 0);
    // Any estimated reading flags the month
    expect(monthly[0]!.isEstimated).toBe(true);
  });

  it("returns empty array for empty input", () => {
    expect(aggregateToMonthly([])).toHaveLength(0);
  });
});

// ── Token Encryption ────────────────────────────────────────────────────────

describe("Token Encryption", () => {
  const key = "test-encryption-key-for-unit-tests-32chars";
  const accessPurpose = "green-button-access-token";

  it("encrypts and decrypts a token correctly", () => {
    const original = "sk_live_abc123_very_secret_token";
    const encrypted = sealSecret({
      plaintext: original,
      masterKey: key,
      purpose: accessPurpose,
    });
    const decrypted = openSecret({
      envelope: encrypted,
      masterKey: key,
      purpose: accessPurpose,
    });

    expect(decrypted).toBe(original);
    expect(encrypted).not.toBe(original);
  });

  it("produces different ciphertexts for the same input (random IV)", () => {
    const token = "same-token-each-time";
    const enc1 = sealSecret({
      plaintext: token,
      masterKey: key,
      purpose: accessPurpose,
    });
    const enc2 = sealSecret({
      plaintext: token,
      masterKey: key,
      purpose: accessPurpose,
    });

    expect(enc1).not.toBe(enc2);
    expect(
      openSecret({ envelope: enc1, masterKey: key, purpose: accessPurpose }),
    ).toBe(token);
    expect(
      openSecret({ envelope: enc2, masterKey: key, purpose: accessPurpose }),
    ).toBe(token);
  });

  it("fails to decrypt with wrong key", () => {
    const encrypted = sealSecret({
      plaintext: "secret",
      masterKey: key,
      purpose: accessPurpose,
    });
    expect(() =>
      openSecret({
        envelope: encrypted,
        masterKey: "wrong-key-wrong-key-wrong-key-32",
        purpose: accessPurpose,
      }),
    ).toThrow("Secret envelope authentication failed.");
  });

  it("fails on invalid envelope format", () => {
    expect(() =>
      openSecret({
        envelope: "not-valid-format",
        masterKey: key,
        purpose: accessPurpose,
      }),
    ).toThrow(
      "Invalid secret envelope format.",
    );
  });

  it("fails on tampered envelope data", () => {
    const encrypted = sealSecret({
      plaintext: "secret",
      masterKey: key,
      purpose: accessPurpose,
    });
    const parsed = JSON.parse(encrypted) as { ciphertext: string };
    parsed.ciphertext = `${parsed.ciphertext}tampered`;

    expect(() =>
      openSecret({
        envelope: JSON.stringify(parsed),
        masterKey: key,
        purpose: accessPurpose,
      }),
    ).toThrow("Secret envelope authentication failed.");
  });

  it("handles empty string token", () => {
    const encrypted = sealSecret({
      plaintext: "",
      masterKey: key,
      purpose: accessPurpose,
    });
    expect(
      openSecret({ envelope: encrypted, masterKey: key, purpose: accessPurpose }),
    ).toBe("");
  });
});

describe("Green Button credential storage", () => {
  const masterKey = "test-encryption-key-for-unit-tests-32chars";

  function buildRecord(
    overrides: Partial<GreenButtonCredentialRecord> = {},
  ): GreenButtonCredentialRecord {
    return {
      id: "gb_conn_1",
      buildingId: "building_1",
      organizationId: "org_1",
      status: "ACTIVE",
      accessToken: null,
      refreshToken: null,
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      tokenEncryptionVersion: null,
      tokenExpiresAt: new Date("2026-03-19T00:00:00.000Z"),
      resourceUri: "https://utility.example.com/espi/resource/Subscription/123",
      subscriptionId: "123",
      ...overrides,
    };
  }

  it("reads encrypted credentials without migration fallback", () => {
    const accessTokenEncrypted = sealSecret({
      plaintext: "encrypted-access",
      masterKey,
      purpose: "green-button-access-token",
    });
    const refreshTokenEncrypted = sealSecret({
      plaintext: "encrypted-refresh",
      masterKey,
      purpose: "green-button-refresh-token",
    });

    const resolved = resolveGreenButtonTokensFromRecord({
      record: buildRecord({
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokenEncryptionVersion: GREEN_BUTTON_TOKEN_ENCRYPTION_VERSION,
      }),
      masterKey,
    });

    expect(resolved.usedPlaintextFallback).toBe(false);
    expect(resolved.tokens.accessToken).toBe("encrypted-access");
    expect(resolved.tokens.refreshToken).toBe("encrypted-refresh");
  });

  it("supports plaintext fallback during migration", () => {
    const resolved = resolveGreenButtonTokensFromRecord({
      record: buildRecord({
        accessToken: "legacy-access",
        refreshToken: "legacy-refresh",
      }),
      masterKey,
    });

    expect(resolved.usedPlaintextFallback).toBe(true);
    expect(resolved.tokens.accessToken).toBe("legacy-access");
    expect(resolved.tokens.refreshToken).toBe("legacy-refresh");
  });

  it("re-encrypts plaintext credentials when read through the helper", async () => {
    const update = vi.fn(async () => null);

    const tokens = await getGreenButtonTokensForConnection({
      record: buildRecord({
        accessToken: "legacy-access",
        refreshToken: "legacy-refresh",
      }),
      masterKey,
      db: {
        greenButtonConnection: {
          update,
        },
      },
    });

    expect(tokens.accessToken).toBe("legacy-access");
    expect(tokens.refreshToken).toBe("legacy-refresh");
    expect(update).toHaveBeenCalledTimes(1);
    const updateArgs = (update.mock.calls as unknown as Array<
      [
        {
          where: { id: string };
          data: {
            accessToken: null;
            refreshToken: null;
            tokenEncryptionVersion: number;
            accessTokenEncrypted: string;
            refreshTokenEncrypted: string;
          };
        },
      ]
    >)[0]?.[0];

    expect(updateArgs).toBeDefined();
    expect(updateArgs).toMatchObject({
      where: { id: "gb_conn_1" },
      data: {
        accessToken: null,
        refreshToken: null,
        tokenEncryptionVersion: GREEN_BUTTON_TOKEN_ENCRYPTION_VERSION,
      },
    });
    expect(updateArgs?.data.accessTokenEncrypted).toEqual(
      expect.any(String),
    );
    expect(updateArgs?.data.refreshTokenEncrypted).toEqual(
      expect.any(String),
    );
  });

  it("fails clearly when no token material is available", () => {
    expect(() =>
      resolveGreenButtonTokensFromRecord({
        record: buildRecord(),
        masterKey,
      }),
    ).toThrow("Green Button connection is missing stored OAuth tokens.");
  });
});

// ── OAuth Helpers ───────────────────────────────────────────────────────────

describe("OAuth Helpers", () => {
  const config = {
    clientId: "test-client-id",
    clientSecret: "test-secret",
    authorizationEndpoint: "https://utility.example.com/oauth/authorize",
    tokenEndpoint: "https://utility.example.com/oauth/token",
    redirectUri: "https://app.example.com/api/green-button/callback",
    scope: "FB=4_5_15",
  };

  it("builds authorization URL with correct params", () => {
    const url = buildAuthorizationUrl(config, "csrf-state-123");

    expect(url).toContain("https://utility.example.com/oauth/authorize?");
    expect(url).toContain("response_type=code");
    expect(url).toContain("client_id=test-client-id");
    expect(url).toContain(
      "redirect_uri=https%3A%2F%2Fapp.example.com%2Fapi%2Fgreen-button%2Fcallback",
    );
    expect(url).toContain("scope=FB%3D4_5_15");
    expect(url).toContain("state=csrf-state-123");
  });

  it("generates a random state token (64 hex chars)", () => {
    const state1 = generateState();
    const state2 = generateState();

    expect(state1).toHaveLength(64);
    expect(state2).toHaveLength(64);
    expect(state1).not.toBe(state2);
    expect(/^[a-f0-9]+$/.test(state1)).toBe(true);
  });

  it("extracts subscriptionId from resourceURI", () => {
    expect(
      extractSubscriptionId(
        "https://api.pepco.com/espi/1_1/resource/Subscription/12345",
      ),
    ).toBe("12345");
  });

  it("returns empty string for URI without Subscription", () => {
    expect(extractSubscriptionId("https://api.pepco.com/other")).toBe("");
    expect(extractSubscriptionId("")).toBe("");
  });

  it("classifies token exchange 400s as non-retryable integration errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("bad request", {
          status: 400,
        }),
      ),
    );

    await expect(exchangeCodeForTokens(config, "bad-code")).rejects.toBeInstanceOf(
      NonRetryableIntegrationError,
    );
  });

  it("classifies token refresh 503s as retryable integration errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("service unavailable", {
          status: 503,
        }),
      ),
    );

    await expect(refreshAccessToken(config, "refresh-token")).rejects.toBeInstanceOf(
      RetryableIntegrationError,
    );
  });
});
