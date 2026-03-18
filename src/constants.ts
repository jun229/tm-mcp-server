import { homedir } from "node:os";
import { join } from "node:path";

export const API_HOST = "https://api.truemarkets.co";
export const API_VERSION = "2026-01-26";

export const CONFIG_DIR = join(homedir(), ".config", "truemarkets");
export const CREDENTIALS_PATH = join(CONFIG_DIR, "credentials.json");
export const KEYS_DIR = join(CONFIG_DIR, "keys");
