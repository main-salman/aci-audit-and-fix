import { z } from "zod";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const ConfigSchema = z.object({
  GROQ_API_KEY: z.string().min(1, "GROQ_API_KEY is required in .env"),
  GROQ_MODEL: z.string().default("openai/gpt-oss-120b"),
  APIC_URL: z.string().url().default("https://sandboxapicdc.cisco.com"),
  APIC_USERNAME: z.string().default("admin"),
  APIC_PASSWORD: z.string().default("!v3G@!4@Y"),
  APIC_VERIFY_SSL: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  ACI_MODE: z.enum(["mock", "live"]).default("mock"),
  APP_PORT: z.coerce.number().default(3300),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function getConfig(): AppConfig {
  const parsed = ConfigSchema.safeParse({
    GROQ_API_KEY: process.env.GROQ_API_KEY || "gsk_missing_key",
    GROQ_MODEL: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    APIC_URL: process.env.APIC_URL || "https://sandboxapicdc.cisco.com",
    APIC_USERNAME: process.env.APIC_USERNAME || "admin",
    APIC_PASSWORD: process.env.APIC_PASSWORD || "!v3G@!4@Y",
    APIC_VERIFY_SSL: process.env.APIC_VERIFY_SSL || "false",
    ACI_MODE: (process.env.ACI_MODE as "mock" | "live") || "mock",
    APP_PORT: process.env.APP_PORT || 3300,
  });

  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}
