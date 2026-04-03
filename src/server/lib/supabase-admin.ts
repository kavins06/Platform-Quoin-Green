import { createClient } from "@supabase/supabase-js";
import { createLogger } from "@/server/lib/logger";
import { getSupabaseAuthConfig, getSupabaseServiceRoleKey } from "@/server/lib/config";

let adminClient:
  | ReturnType<typeof createClient>
  | null = null;

function getClient() {
  if (adminClient) {
    return adminClient;
  }

  const auth = getSupabaseAuthConfig();
  adminClient = createClient(auth.url, getSupabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return adminClient;
}

export async function ensurePrivateStorageBucket(bucketName: string) {
  const client = getClient();
  const logger = createLogger({
    component: "supabase-admin",
    bucketName,
  });
  const { data: existing, error: existingError } = await client.storage.getBucket(bucketName);

  if (existing) {
    return existing;
  }

  if (existingError && !existingError.message.toLowerCase().includes("not found")) {
    throw existingError;
  }

  const { data, error } = await client.storage.createBucket(bucketName, {
    public: false,
    fileSizeLimit: "20MB",
    allowedMimeTypes: [
      "application/pdf",
      "image/png",
      "image/jpeg",
    ],
  });

  if (
    error &&
    !error.message.toLowerCase().includes("already exists") &&
    !error.message.toLowerCase().includes("duplicate")
  ) {
    throw error;
  }

  if (error) {
    logger.info("Storage bucket already existed during create", { error: error.message });
  }

  return data;
}

export async function uploadPrivateStorageObject(input: {
  bucketName: string;
  storagePath: string;
  file: ArrayBuffer | Uint8Array | Buffer;
  contentType: string;
}) {
  const client = getClient();
  const { data, error } = await client.storage
    .from(input.bucketName)
    .upload(input.storagePath, input.file, {
      contentType: input.contentType,
      upsert: false,
    });

  if (error) {
    throw error;
  }

  return data;
}

export async function downloadPrivateStorageObject(input: {
  bucketName: string;
  storagePath: string;
}) {
  const client = getClient();
  const { data, error } = await client.storage
    .from(input.bucketName)
    .download(input.storagePath);

  if (error) {
    throw error;
  }

  return data;
}

export async function createSignedStorageUrl(input: {
  bucketName: string;
  storagePath: string;
  expiresInSeconds: number;
}) {
  const client = getClient();
  const { data, error } = await client.storage
    .from(input.bucketName)
    .createSignedUrl(input.storagePath, input.expiresInSeconds);

  if (error) {
    throw error;
  }

  return data.signedUrl;
}
