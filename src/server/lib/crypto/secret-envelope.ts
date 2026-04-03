import crypto from "node:crypto";
import { ConfigError } from "@/server/lib/errors";

const ENVELOPE_VERSION = 1 as const;
const ENVELOPE_ALGORITHM = "aes-256-gcm" as const;
const KEY_SALT_PREFIX = "quoin:secret-envelope";

interface SecretEnvelopeV1 {
  v: typeof ENVELOPE_VERSION;
  alg: typeof ENVELOPE_ALGORITHM;
  iv: string;
  tag: string;
  ciphertext: string;
}

function deriveKey(masterKey: string, purpose: string) {
  return crypto.scryptSync(masterKey, `${KEY_SALT_PREFIX}:${purpose}`, 32);
}

function parseEnvelope(serialized: string): SecretEnvelopeV1 {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new ConfigError("Invalid secret envelope format.");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("v" in parsed) ||
    !("alg" in parsed) ||
    !("iv" in parsed) ||
    !("tag" in parsed) ||
    !("ciphertext" in parsed) ||
    (parsed as SecretEnvelopeV1).v !== ENVELOPE_VERSION ||
    (parsed as SecretEnvelopeV1).alg !== ENVELOPE_ALGORITHM
  ) {
    throw new ConfigError("Invalid secret envelope metadata.");
  }

  return parsed as SecretEnvelopeV1;
}

export function getSecretEnvelopeVersion() {
  return ENVELOPE_VERSION;
}

export function sealSecret(input: {
  plaintext: string;
  masterKey: string;
  purpose: string;
}) {
  const key = deriveKey(input.masterKey, input.purpose);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENVELOPE_ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(input.purpose, "utf8"));

  const encrypted = Buffer.concat([
    cipher.update(input.plaintext, "utf8"),
    cipher.final(),
  ]);

  const envelope: SecretEnvelopeV1 = {
    v: ENVELOPE_VERSION,
    alg: ENVELOPE_ALGORITHM,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };

  return JSON.stringify(envelope);
}

export function openSecret(input: {
  envelope: string;
  masterKey: string;
  purpose: string;
}) {
  const parsed = parseEnvelope(input.envelope);
  const key = deriveKey(input.masterKey, input.purpose);
  const decipher = crypto.createDecipheriv(
    ENVELOPE_ALGORITHM,
    key,
    Buffer.from(parsed.iv, "base64"),
  );

  decipher.setAAD(Buffer.from(input.purpose, "utf8"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));

  try {
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    throw new ConfigError("Secret envelope authentication failed.");
  }
}
