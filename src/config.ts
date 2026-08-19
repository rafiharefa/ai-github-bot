import dotenv from "dotenv";
dotenv.config();

export interface BotConfig {
  geminiApiKey: string;
  geminiModel: string;
  appId: string;
  privateKey: string;
  webhookSecret: string;
  botTriggerName: string;
}

export function getBotConfig(): BotConfig {
  const geminiApiKey = process.env.GEMINI_API_KEY || "";
  const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const appId = process.env.GITHUB_APP_ID || "";
  let privateKey = process.env.GITHUB_PRIVATE_KEY || "";
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET || "";
  const botTriggerName = process.env.BOT_TRIGGER_NAME || "@rafiharefa-bot";

  // Handle base64 encoded private key or escaped newlines
  if (privateKey.startsWith("-----BEGIN") === false && privateKey.length > 50) {
    try {
      privateKey = Buffer.from(privateKey, "base64").toString("utf-8");
    } catch {
      // Keep as is if decode fails
    }
  }
  privateKey = privateKey.replace(/\\n/g, "\n");

  return {
    geminiApiKey,
    geminiModel,
    appId,
    privateKey,
    webhookSecret,
    botTriggerName,
  };
}
