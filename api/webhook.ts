import { Webhooks } from "@octokit/webhooks";
import type { IncomingMessage, ServerResponse } from "node:http";
import http from "node:http";
import { getBotConfig } from "../src/config.js";
import { GeminiService } from "../src/services/gemini.js";
import { GitHubService } from "../src/services/github.js";

const config = getBotConfig();

const webhooks = new Webhooks({
  secret: config.webhookSecret || "development_secret",
});

let _githubService: GitHubService | null = null;
function getGitHubService(): GitHubService {
  if (!_githubService) {
    if (!config.appId || !config.privateKey) {
      throw new Error("GITHUB_APP_ID and GITHUB_PRIVATE_KEY must be configured in environment variables.");
    }
    _githubService = new GitHubService(config.appId, config.privateKey);
  }
  return _githubService;
}

let _geminiService: GeminiService | null = null;
function getGeminiService(): GeminiService {
  if (!_geminiService) {
    if (!config.geminiApiKey) {
      throw new Error("GEMINI_API_KEY must be configured in environment variables.");
    }
    _geminiService = new GeminiService(config.geminiApiKey, config.geminiModel);
  }
  return _geminiService;
}

// 1. Handle issue opened with label 'ai' or 'ai-task' or bot mention
webhooks.on("issues.opened", async ({ payload }) => {
  const issue = payload.issue;
  const repository = payload.repository;
  const installation = payload.installation;

  console.log(`[Event] issues.opened on ${repository.full_name} #${issue.number}: "${issue.title}"`);

  if (!installation) {
    console.warn("[Warn] No installation found on payload.");
    return;
  }

  const hasAiLabel = (issue.labels || []).some(
    (l) => typeof l === "object" && (l.name === "ai" || l.name === "ai-task" || l.name === "ai-developer")
  );
  const mentionsBot =
    issue.body?.includes(config.botTriggerName) ||
    issue.title.startsWith("[AI]") ||
    issue.title.toLowerCase().includes("[ai]");

  if (!hasAiLabel && !mentionsBot) {
    console.log("[Info] Issue did not match AI trigger conditions.");
    return;
  }

  await processTask({
    installationId: installation.id,
    owner: repository.owner.login,
    repo: repository.name,
    issueNumber: issue.number,
    taskTitle: issue.title,
    taskBody: issue.body || "",
  });
});

// 2. Handle issue comments mentioning the bot (e.g., "@rafiharefa-bot develop ...")
webhooks.on("issue_comment.created", async ({ payload }) => {
  const comment = payload.comment;
  const issue = payload.issue;
  const repository = payload.repository;
  const installation = payload.installation;

  console.log(`[Event] issue_comment.created on ${repository.full_name} #${issue.number}`);

  if (comment.user?.type === "Bot" || !installation) return;

  const commentBody = comment.body.trim();
  if (!commentBody.includes(config.botTriggerName) && !commentBody.startsWith("/ai")) {
    console.log("[Info] Comment did not match bot trigger name.");
    return;
  }

  const prompt = commentBody.replace(config.botTriggerName, "").replace("/ai", "").trim();

  await processTask({
    installationId: installation.id,
    owner: repository.owner.login,
    repo: repository.name,
    issueNumber: issue.number,
    taskTitle: issue.title,
    taskBody: `Task instructions: ${prompt}\n\nOriginal Issue Context:\n${issue.body || ""}`,
  });
});

async function processTask(params: {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  taskTitle: string;
  taskBody: string;
}) {
  const { installationId, owner, repo, issueNumber, taskTitle, taskBody } = params;
  console.log(`[Task] Starting AI task on ${owner}/${repo} #${issueNumber}...`);

  try {
    const githubService = getGitHubService();
    const geminiService = getGeminiService();
    const octokit = await githubService.getInstallationOctokit(installationId);

    // Acknowledge receipt
    await githubService.postIssueComment(
      octokit,
      owner,
      repo,
      issueNumber,
      `🤖 **AI Autonomous Developer** sedang menganalisis arsitektur dan memproses task...\n\n- **Target Branch**: Akan dibuat branch terisolasi baru (aturan: *never develop on existing branch*).\n- **Engine**: Google Gemini (${config.geminiModel}).`
    );

    // 1. Fetch Repo Context
    console.log(`[Task] Fetching repository context...`);
    const repoContext = await githubService.getRepositoryContext(octokit, owner, repo);

    // 2. Generate Solution via Gemini
    console.log(`[Task] Generating code changes via Gemini...`);
    const resolution = await geminiService.generateCodeChanges({
      repoName: `${owner}/${repo}`,
      issueTitle: taskTitle,
      issueBody: taskBody,
      repoStructure: repoContext.fileList,
      contextFiles: repoContext.contextFiles,
    });

    if (!resolution.files || resolution.files.length === 0) {
      console.log(`[Task] No files generated.`);
      await githubService.postIssueComment(
        octokit,
        owner,
        repo,
        issueNumber,
        `⚠️ AI selesai menganalisis tetapi tidak mendeteksi file yang perlu dimodifikasi untuk task ini.`
      );
      return;
    }

    // 3. Create Isolated Feature Branch & Open PR
    console.log(`[Task] Creating branch ${resolution.branchName} and opening PR...`);
    const prResult = await githubService.createFeatureBranchAndPR({
      octokit,
      owner,
      repo,
      baseBranch: repoContext.defaultBranch,
      baseCommitSha: repoContext.latestCommitSha,
      suggestedBranchName: resolution.branchName,
      commitMessage: `feat(ai): ${resolution.prTitle} (closes #${issueNumber})`,
      files: resolution.files,
      prTitle: `[AI] ${resolution.prTitle}`,
      prBody: resolution.summary,
      issueNumber,
    });

    // 4. Report Success on Issue
    console.log(`[Task] Successfully opened PR #${prResult.prNumber}`);
    await githubService.postIssueComment(
      octokit,
      owner,
      repo,
      issueNumber,
      `✅ **Implementasi Selesai!**\n\n- **Branch Baru**: \`${prResult.branchName}\`\n- **Pull Request**: [#${prResult.prNumber} (${resolution.prTitle})](${prResult.prUrl})\n\n**Ringkasan Perubahan:**\n${resolution.summary}\n\n*Silakan review Pull Request. Setelah di-merge ke branch utama, pipeline automated deployment akan berjalan otomatis.*`
    );
  } catch (error: any) {
    console.error("[Task Error]", error);
    try {
      const githubService = getGitHubService();
      const octokit = await githubService.getInstallationOctokit(installationId);
      await githubService.postIssueComment(
        octokit,
        owner,
        repo,
        issueNumber,
        `❌ **Gagal menjalankan otomasi AI:**\n\`\`\`\n${error?.message || error}\n\`\`\``
      );
    } catch (commentErr) {
      console.error("[Task Error] Failed to post error comment:", commentErr);
    }
  }
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

// Vercel Serverless Function entry point
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "GET") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        status: "online",
        service: "ai-github-bot",
        configured: {
          hasGeminiKey: Boolean(config.geminiApiKey),
          hasAppId: Boolean(config.appId),
          hasPrivateKey: Boolean(config.privateKey),
          hasWebhookSecret: Boolean(config.webhookSecret),
          model: config.geminiModel,
        },
      })
    );
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  const id = (req.headers["x-github-delivery"] as string) || "";
  const name = (req.headers["x-github-event"] as any) || "";
  const signature = (req.headers["x-hub-signature-256"] as string) || "";

  console.log(`[Webhook Inbound] Event: ${name}, Delivery: ${id}`);

  try {
    const rawBody = await readBody(req);
    
    // Process webhook
    await webhooks.verifyAndReceive({
      id,
      name,
      signature,
      payload: rawBody,
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, event: name, delivery: id }));
  } catch (error: any) {
    console.error("[Webhook Verification/Processing Error]", error);
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error?.message || "Webhook processing failed" }));
  }
}

// Standalone mode for local development
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  const server = http.createServer(handler);
  server.listen(PORT, () => {
    console.log(`🤖 AI GitHub Bot webhook listener running on port ${PORT}`);
  });
}
