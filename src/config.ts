import dotenv from "dotenv";
dotenv.config();

export interface BotConfig {
  geminiApiKey: string;
  geminiModel: string;
  appId: string;
  privateKey: string;
  webhookSecret: string;
  botTriggerName: string;
  telegramBotToken: string;
  telegramAllowedUserId: string;
  githubOwner: string;
}

function sanitizeEnv(value: string | undefined): string {
  if (!value) return "";
  let clean = value.trim();
  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
    clean = clean.slice(1, -1);
  }
  return clean.trim();
}

export function getBotConfig(): BotConfig {
  const geminiApiKey = sanitizeEnv(process.env.GEMINI_API_KEY);
  const geminiModel = sanitizeEnv(process.env.GEMINI_MODEL) || "gemini-3.7-flash";
  const appId = sanitizeEnv(process.env.GITHUB_APP_ID);
  let privateKey = process.env.GITHUB_PRIVATE_KEY || "";
  const webhookSecret = sanitizeEnv(process.env.GITHUB_WEBHOOK_SECRET);
  const botTriggerName = sanitizeEnv(process.env.BOT_TRIGGER_NAME) || "@rafiharefa-bot";
  const telegramBotToken = sanitizeEnv(process.env.TELEGRAM_BOT_TOKEN);
  const telegramAllowedUserId = sanitizeEnv(process.env.TELEGRAM_ALLOWED_USER_ID);
  const githubOwner = sanitizeEnv(process.env.GITHUB_OWNER) || "rafiharefa";

  // Handle base64 encoded private key or escaped newlines
  privateKey = privateKey.trim();
  if ((privateKey.startsWith('"') && privateKey.endsWith('"')) || (privateKey.startsWith("'") && privateKey.endsWith("'"))) {
    privateKey = privateKey.slice(1, -1);
  }

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
    telegramBotToken,
    telegramAllowedUserId,
    githubOwner,
  };
}
