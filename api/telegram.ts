import type { IncomingMessage, ServerResponse } from "node:http";
import http from "node:http";
import { getBotConfig } from "../src/config.js";
import { GeminiService } from "../src/services/gemini.js";
import { GitHubService } from "../src/services/github.js";
import { TelegramService, TelegramUpdate } from "../src/services/telegram.js";

const config = getBotConfig();

let _githubService: GitHubService | null = null;
function getGitHubService(): GitHubService {
  if (!_githubService) {
    if (!config.appId || !config.privateKey) {
      throw new Error("GITHUB_APP_ID and GITHUB_PRIVATE_KEY must be configured.");
    }
    _githubService = new GitHubService(config.appId, config.privateKey);
  }
  return _githubService;
}

let _geminiService: GeminiService | null = null;
function getGeminiService(): GeminiService {
  if (!_geminiService) {
    if (!config.geminiApiKey) {
      throw new Error("GEMINI_API_KEY must be configured.");
    }
    _geminiService = new GeminiService(config.geminiApiKey, config.geminiModel);
  }
  return _geminiService;
}

let _telegramService: TelegramService | null = null;
function getTelegramService(): TelegramService {
  if (!_telegramService) {
    if (!config.telegramBotToken) {
      throw new Error("TELEGRAM_BOT_TOKEN must be configured.");
    }
    _telegramService = new TelegramService(config.telegramBotToken);
  }
  return _telegramService;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // 1. Healthcheck and Webhook Setup via GET
  if (req.method === "GET") {
    const urlObj = new URL(req.url || "", `http://${req.headers.host}`);
    const shouldSetWebhook = urlObj.searchParams.get("setWebhook");

    if (shouldSetWebhook && config.telegramBotToken) {
      try {
        const tg = getTelegramService();
        const webhookUrl = `https://${req.headers.host}/api/telegram`;
        const result = await tg.setWebhook(webhookUrl);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: "webhook_registered", webhookUrl, result }));
        return;
      } catch (err: any) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err?.message || err }));
        return;
      }
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        status: "online",
        service: "telegram-bot-interface",
        hasTelegramToken: Boolean(config.telegramBotToken),
        hasAllowedUser: Boolean(config.telegramAllowedUserId),
        defaultOwner: config.githubOwner,
      })
    );
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  try {
    const rawBody = await readBody(req);
    const update: TelegramUpdate = JSON.parse(rawBody);

    if (!update.message || !update.message.text) {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, ignored: "no_text" }));
      return;
    }

    const message = update.message;
    const chatId = message.chat.id;
    const fromId = message.from?.id ? message.from.id.toString() : "";
    const text = (message.text || "").trim();

    const telegramService = getTelegramService();

    // Security Check: Whitelist verification (Mandatory)
    if (!config.telegramAllowedUserId || fromId !== config.telegramAllowedUserId) {
      console.warn(`[Telegram Security] Unauthorized attempt from user ID: ${fromId}`);
      await telegramService.sendMessage(
        chatId,
        `⛔ **Akses Ditolak**\nAkun Telegram Anda (ID: \`${fromId || "Unknown"}\`) tidak terdaftar dalam whitelist.\n\n*Pastikan variabel TELEGRAM_ALLOWED_USER_ID di Vercel telah diisi dengan User ID Anda.*`
      );
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, status: "unauthorized" }));
      return;
    }

    // Command: /start or /help
    if (text === "/start" || text === "/help") {
      const welcomeMsg = `🤖 **Rafi AI Developer Bot (Mobile Interface)**\n\nSelamat datang! Anda dapat memicu development, bertanya arsitektur, atau membuat PR langsung dari chat ini.\n\n**📌 Perintah Tersedia:**\n• \`/repos\` — Menampilkan daftar repositori GitHub Anda.\n• \`/repo <nama_repo> <instruksi>\` — Menargetkan repo tertentu.\n\n**💡 Contoh Pemakaian:**\n1. *Tanya Jawab Arsitektur:*\n   \`/repo vanderandco bagaimana struktur folder di project ini?\`\n2. *Membuat Fitur & Pull Request:*\n   \`/repo vanderandco tolong tambahkan badge MIT di README.md\`\n3. *Mobile App Flutter:*\n   \`/repo notif_tracking buatkan unit test untuk auth service\``;

      await telegramService.sendMessage(chatId, welcomeMsg);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Command: /repos
    if (text === "/repos") {
      await telegramService.sendChatAction(chatId, "typing");
      const githubService = getGitHubService();
      const repos = await githubService.listAccessibleRepositories(config.githubOwner);

      if (repos.length === 0) {
        await telegramService.sendMessage(chatId, `⚠️ Tidak ada repositori yang ditemukan untuk akun \`${config.githubOwner}\`.`);
      } else {
        const repoListText = repos
          .map((r, i) => `${i + 1}. **${r.name}** (${r.private ? "🔒 Private" : "🌐 Public"})\n   Branch: \`${r.default_branch}\``)
          .join("\n\n");

        await telegramService.sendMessage(
          chatId,
          `📂 **Daftar Repositori GitHub (@${config.githubOwner}):**\n\n${repoListText}\n\n*Gunakan \`/repo <nama_repo> <instruksi>\` untuk mulai berinteraksi.*`
        );
      }

      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Parse target repository and prompt
    let targetRepo = "";
    let prompt = text;

    if (text.startsWith("/repo ")) {
      const parts = text.slice(6).trim().split(" ");
      targetRepo = parts[0];
      prompt = parts.slice(1).join(" ").trim();
    }

    if (!targetRepo) {
      targetRepo = "vanderandco"; // Default fallback repo
    }

    if (!prompt) {
      await telegramService.sendMessage(
        chatId,
        `⚠️ Mohon sertakan instruksi Anda.\nContoh: \`/repo ${targetRepo} tolong jelaskan cara kerja API\``
      );
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Notify user: Processing
    await telegramService.sendChatAction(chatId, "typing");
    await telegramService.sendMessage(
      chatId,
      `⏳ **AI Developer sedang memproses...**\n• **Target:** \`${config.githubOwner}/${targetRepo}\`\n• **Engine:** Google Gemini (${config.geminiModel})\n• **Instruksi:** _"${prompt}"_`
    );

    const githubService = getGitHubService();
    const geminiService = getGeminiService();

    // 1. Resolve Installation & Context
    const { octokit } = await githubService.getRepoInstallationOctokit(
      config.githubOwner,
      targetRepo
    );

    const repoContext = await githubService.getRepositoryContext(
      octokit,
      config.githubOwner,
      targetRepo
    );

    // 2. Process Multi-turn Reasoning via Gemini
    await telegramService.sendChatAction(chatId, "typing");
    const resolution = await geminiService.processConversationalTask({
      repoName: `${config.githubOwner}/${targetRepo}`,
      issueTitle: prompt.slice(0, 50),
      issueBody: prompt,
      threadHistory: [{ author: "telegram_user", content: prompt }],
      isPullRequest: false,
      repoStructure: repoContext.fileList,
      contextFiles: repoContext.contextFiles,
    });

    const fallbackNotice =
      resolution.fallbackWarnings && resolution.fallbackWarnings.length > 0
        ? `\n\nℹ️ *Notice: ${resolution.fallbackWarnings.join(", ")} (Engine: ${resolution.modelUsed})*`
        : "";

    // 3. Response Dispatch
    if (resolution.actionType === "CHAT_REPLY") {
      // Q&A / Architecture discussion
      const chatHeader = `💡 **AI Software Architect** (${resolution.modelUsed})\n\n`;
      await telegramService.sendMessage(chatId, chatHeader + resolution.replyMessage + fallbackNotice);
    } else {
      // Code Synthesis -> Create Branch & PR
      await telegramService.sendChatAction(chatId, "typing");
      const prResult = await githubService.createFeatureBranchAndPR({
        octokit,
        owner: config.githubOwner,
        repo: targetRepo,
        baseBranch: repoContext.defaultBranch,
        baseCommitSha: repoContext.latestCommitSha,
        suggestedBranchName: resolution.branchName || `ai/telegram-${Date.now().toString().slice(-4)}`,
        commitMessage: `feat(ai): ${resolution.prTitle || prompt} (via Telegram)`,
        files: resolution.files,
        prTitle: `[AI] ${resolution.prTitle || prompt}`,
        prBody: (resolution.summary || resolution.replyMessage) + fallbackNotice,
      });

      const fileListMarkdown = resolution.files
        .map((f) => `• \`${f.path}\` (${f.action})`)
        .join("\n");

      const successMsg = `✅ **Pull Request Berhasil Dibuat!**\n\n🔗 **PR:** [${resolution.prTitle || prompt}](${prResult.prUrl})\n🌿 **Branch:** \`${prResult.branchName}\`\n🎯 **Base:** \`${repoContext.defaultBranch}\`\n🤖 **Engine:** \`${resolution.modelUsed}\`\n\n**📄 File Dimodifikasi:**\n${fileListMarkdown}\n\n**Ringkasan:**\n${resolution.summary || resolution.replyMessage}${fallbackNotice}`;

      await telegramService.sendMessage(chatId, successMsg);
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  } catch (error: any) {
    console.error("[Telegram Bot Error]", error);
    try {
      if (config.telegramBotToken) {
        const rawBody = await readBody(req).catch(() => "");
        const update = rawBody ? JSON.parse(rawBody) : null;
        if (update?.message?.chat?.id) {
          const tg = getTelegramService();
          await tg.sendMessage(
            update.message.chat.id,
            `❌ **Gagal menjalankan tugas:**\n\`\`\`\n${error?.message || error}\n\`\`\``
          );
        }
      }
    } catch {
      // Ignore fallback errors
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ error: error?.message || error }));
  }
}

// Standalone mode for local development
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  const PORT = process.env.PORT || 3001;
  const server = http.createServer(handler);
  server.listen(PORT, () => {
    console.log(`🤖 Telegram Bot endpoint running on port ${PORT}`);
  });
}
