import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type StoredFyersSession = {
  accessToken: string;
  refreshToken?: string;
  createdAt: string;
};

const dataDir = path.join(process.cwd(), ".data");
const sessionPath = path.join(dataDir, "fyers-session.json");

export async function saveFyersSession(
  session: StoredFyersSession
): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(sessionPath, JSON.stringify(session, null, 2), {
    encoding: "utf8",
    mode: 0o600
  });
}

export async function readFyersSession(): Promise<StoredFyersSession | null> {
  try {
    const content = await readFile(sessionPath, "utf8");
    const parsed = JSON.parse(content) as StoredFyersSession;

    if (!parsed.accessToken) {
      return null;
    }

    return parsed;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";

    if (code === "ENOENT") {
      return null;
    }

    throw error;
  }
}
