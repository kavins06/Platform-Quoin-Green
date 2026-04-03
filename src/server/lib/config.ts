import { z } from "zod";

/** Treat empty strings as undefined so `VAR=` in .env acts like unset. */
const optStr = z
  .string()
  .transform((s) => (s === "" ? undefined : s))
  .pipe(z.string().optional());

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    NEXT_PUBLIC_SUPABASE_URL: optStr.pipe(z.string().url().optional()),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optStr,
    SUPABASE_SERVICE_ROLE_KEY: optStr,
    OCR_SPACE_API_KEY: optStr,
    GEMINI_API_KEY: optStr,
    GEMINI_MODEL: optStr,
    ESPM_BASE_URL: z
      .string()
      .url()
      .default("https://portfoliomanager.energystar.gov/ws"),
    ESPM_USERNAME: optStr,
    ESPM_PASSWORD: optStr,
    ESPM_CREDENTIAL_MASTER_KEY: optStr.pipe(z.string().min(16).optional()),
    NEXT_PUBLIC_MAPBOX_TOKEN: optStr,
    GREEN_BUTTON_CLIENT_ID: optStr,
    GREEN_BUTTON_CLIENT_SECRET: optStr,
    GREEN_BUTTON_AUTH_ENDPOINT: optStr.pipe(z.string().url().optional()),
    GREEN_BUTTON_TOKEN_ENDPOINT: optStr.pipe(z.string().url().optional()),
    GREEN_BUTTON_REDIRECT_URI: optStr.pipe(z.string().url().optional()),
    GREEN_BUTTON_TOKEN_MASTER_KEY: optStr.pipe(z.string().min(16).optional()),
    GREEN_BUTTON_ENCRYPTION_KEY: optStr.pipe(z.string().min(16).optional()),
    GREEN_BUTTON_SCOPE: optStr,
  })
  .superRefine((value, ctx) => {
    if ((value.ESPM_USERNAME && !value.ESPM_PASSWORD) || (!value.ESPM_USERNAME && value.ESPM_PASSWORD)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ESPM_USERNAME and ESPM_PASSWORD must either both be set or both be unset.",
        path: ["ESPM_USERNAME"],
      });
    }

    const greenButtonFields = [
      "GREEN_BUTTON_CLIENT_ID",
      "GREEN_BUTTON_CLIENT_SECRET",
      "GREEN_BUTTON_AUTH_ENDPOINT",
      "GREEN_BUTTON_TOKEN_ENDPOINT",
      "GREEN_BUTTON_REDIRECT_URI",
    ] as const;
    const providedGreenButtonFields = greenButtonFields.filter((field) => !!value[field]);

    if (
      providedGreenButtonFields.length > 0 &&
      providedGreenButtonFields.length !== greenButtonFields.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Green Button OAuth config must be complete when enabled: client id, client secret, auth endpoint, token endpoint, and redirect URI.",
        path: ["GREEN_BUTTON_CLIENT_ID"],
      });
    }

    const greenButtonTokenMasterKey =
      value.GREEN_BUTTON_TOKEN_MASTER_KEY ?? value.GREEN_BUTTON_ENCRYPTION_KEY;

    if (providedGreenButtonFields.length > 0 && !greenButtonTokenMasterKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "GREEN_BUTTON_TOKEN_MASTER_KEY must be set when Green Button OAuth is enabled.",
        path: ["GREEN_BUTTON_TOKEN_MASTER_KEY"],
      });
    }
  });

export const env = envSchema.parse(process.env);

export class ServerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerConfigError";
  }
}

export function getSupabaseAuthConfig() {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new ServerConfigError(
      "Supabase Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return {
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function getSupabaseServiceRoleKey() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new ServerConfigError(
      "Supabase service role key is not configured.",
    );
  }

  return env.SUPABASE_SERVICE_ROLE_KEY;
}

export function getOcrSpaceApiKey() {
  if (!env.OCR_SPACE_API_KEY) {
    throw new ServerConfigError(
      "OCR.space API key is not configured.",
    );
  }

  return env.OCR_SPACE_API_KEY;
}

export function getOptionalGeminiConfig() {
  if (!env.GEMINI_API_KEY) {
    return null;
  }

  return {
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL ?? "gemini-2.5-flash",
  };
}

export function getEspmClientConfig() {
  if (!env.ESPM_USERNAME || !env.ESPM_PASSWORD) {
    throw new ServerConfigError(
      "ESPM integration is not configured. Set both ESPM_USERNAME and ESPM_PASSWORD.",
    );
  }

  return {
    baseUrl: env.ESPM_BASE_URL,
    username: env.ESPM_USERNAME,
    password: env.ESPM_PASSWORD,
  };
}

export function getEspmCredentialMasterKey() {
  const key = process.env.ESPM_CREDENTIAL_MASTER_KEY ?? env.ESPM_CREDENTIAL_MASTER_KEY ?? null;
  return key && key.length >= 16 ? key : null;
}

export function requireEspmCredentialMasterKey() {
  const key = getEspmCredentialMasterKey();
  if (!key) {
    throw new ServerConfigError(
      "ESPM credential master key is not configured.",
    );
  }

  return key;
}

export function getOptionalGreenButtonConfig() {
  if (
    !env.GREEN_BUTTON_CLIENT_ID ||
    !env.GREEN_BUTTON_CLIENT_SECRET ||
    !env.GREEN_BUTTON_AUTH_ENDPOINT ||
    !env.GREEN_BUTTON_TOKEN_ENDPOINT ||
    !env.GREEN_BUTTON_REDIRECT_URI
  ) {
    return null;
  }

  return {
    clientId: env.GREEN_BUTTON_CLIENT_ID,
    clientSecret: env.GREEN_BUTTON_CLIENT_SECRET,
    authorizationEndpoint: env.GREEN_BUTTON_AUTH_ENDPOINT,
    tokenEndpoint: env.GREEN_BUTTON_TOKEN_ENDPOINT,
    redirectUri: env.GREEN_BUTTON_REDIRECT_URI,
    scope:
      env.GREEN_BUTTON_SCOPE ??
      "FB=4_5_15;IntervalDuration=900;BlockDuration=monthly;HistoryLength=13",
  };
}

export function getGreenButtonTokenMasterKey() {
  return env.GREEN_BUTTON_TOKEN_MASTER_KEY ?? env.GREEN_BUTTON_ENCRYPTION_KEY ?? null;
}

export function requireGreenButtonTokenMasterKey() {
  const key = getGreenButtonTokenMasterKey();
  if (!key) {
    throw new ServerConfigError(
      "Green Button token master key is not configured.",
    );
  }

  return key;
}
