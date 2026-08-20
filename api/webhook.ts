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

// 1. Handle issue opened with label 'ai' or 'ai-task' or bot mention / [AI] title
webhooks.on("issues.opened", async ({ payload }) => {
  const issue = payload.issue;
  const repository = payload.repository;
  const installation = payload.installation;

  console.log(`[Event] issues.opened on ${repository.full_name} #${issue.number}: "${issue.title}"`);

  if (!installation) return;

  const hasAiLabel = (issue.labels || []).some(
    (l) => typeof l === "object" && (l.name === "ai" || l.name === "ai-task" || l.name === "ai-developer")
  );
  const mentionsBot =
    issue.body?.includes(config.botTriggerName) ||
    issue.body?.includes("/ai") ||
    issue.title.startsWith("[AI]") ||
    issue.title.toLowerCase().includes("[ai]");

  if (!hasAiLabel && !mentionsBot) {
    console.log("[Info] Issue did not match AI trigger conditions.");
    return;
  }

  // Security Check: Only allow repo owner, collaborators, or members
  const authorAssociation = issue.author_association;
  const senderLogin = issue.user?.login;
  const repoOwner = repository.owner.login;

  const isAuthorized =
    senderLogin === repoOwner ||
    authorAssociation === "OWNER" ||
    authorAssociation === "COLLABORATOR" ||
    authorAssociation === "MEMBER";

  if (!isAuthorized) {
    console.warn(`[Security] Ignored unauthorized issue from @${senderLogin} on ${repository.full_name}`);
    return;
  }

  await processConversationalFlow({
    installationId: installation.id,
    owner: repository.owner.login,
    repo: repository.name,
    issueNumber: issue.number,
    issueTitle: issue.title,
    initialBody: issue.body || "",
    isPullRequest: Boolean(issue.pull_request),
  });
});

// 2. Handle issue comments & PR comments
webhooks.on("issue_comment.created", async ({ payload }) => {
  const comment = payload.comment;
  const issue = payload.issue;
  const repository = payload.repository;
  const installation = payload.installation;

  console.log(`[Event] issue_comment.created on ${repository.full_name} #${issue.number}`);

  if (comment.user?.type === "Bot" || !installation) return;
  const authorAssociation = comment.author_association;
  const senderLogin = comment.user?.login;
  const repoOwner = repository.owner.login;

  const isAuthorized =
    senderLogin === repoOwner ||
    authorAssociation === "OWNER" ||
    authorAssociation === "COLLABORATOR" ||
    authorAssociation === "MEMBER";

  if (!isAuthorized) {
    console.warn(`[Security] Ignored unauthorized trigger from @${senderLogin} on ${repository.full_name}`);
    return;
  }

  await processConversationalFlow({
    installationId: installation.id,
    owner: repository.owner.login,
    repo: repository.name,
    issueNumber: issue.number,
    issueTitle: issue.title,
    initialBody: issue.body || "",
    isPullRequest: Boolean(issue.pull_request),
  });
});

async function processConversationalFlow(params: {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  initialBody: string;
  isPullRequest: boolean;
}) {
  const { installationId, owner, repo, issueNumber, issueTitle, initialBody, isPullRequest } = params;
  console.log(`[Task] Starting conversational AI process on ${owner}/${repo} #${issueNumber} (isPR: ${isPullRequest})...`);

  try {
    const githubService = getGitHubService();
    const geminiService = getGeminiService();
    const octokit = await githubService.getInstallationOctokit(installationId);

    // 1. Fetch Complete Thread History
    const threadHistory = await githubService.getThreadHistory(octokit, owner, repo, issueNumber);

    // 2. Determine PR Branch info if applicable
    let activeBranchName: string | undefined;
    let baseCommitSha: string | undefined;
    let baseBranch: string | undefined;

    if (isPullRequest) {
      const prInfo = await githubService.getPullRequestInfo(octokit, owner, repo, issueNumber);
      activeBranchName = prInfo.branchName;
      baseCommitSha = prInfo.latestCommitSha;
      baseBranch = prInfo.baseBranch;
    }

    // 3. Fetch Repository Context (files & structure)
    const repoContext = await githubService.getRepositoryContext(
      octokit,
      owner,
      repo,
      activeBranchName
    );

    if (!baseCommitSha) {
      baseCommitSha = repoContext.latestCommitSha;
    }
    if (!baseBranch) {
      baseBranch = repoContext.defaultBranch;
    }

    // 4. Process Multi-Turn Reasoning with Gemini
    const resolution = await geminiService.processConversationalTask({
      repoName: `${owner}/${repo}`,
      issueTitle,
      issueBody: initialBody,
      threadHistory,
      isPullRequest,
      activeBranchName,
      repoStructure: repoContext.fileList,
      contextFiles: repoContext.contextFiles,
    });

    console.log(`[Resolution Action] => ${resolution.actionType} (Model: ${resolution.modelUsed})`);

    // Build diagnostic notice if fallback occurred
    const fallbackNotice =
      resolution.fallbackWarnings && resolution.fallbackWarnings.length > 0
        ? `\n\n---\n> ℹ️ **Notice:**\n> ${resolution.fallbackWarnings.join("\n> ")}\n> *Task diselesaikan dengan model:* \`${resolution.modelUsed}\``
        : "";

    // ACTION TYPE 1: CHAT_REPLY (Q&A, Discussion, Explanation - NO FILES MUTATED)
    if (resolution.actionType === "CHAT_REPLY") {
      console.log(`[Task] Replying to discussion without mutating repository.`);
      await githubService.postIssueComment(
        octokit,
        owner,
        repo,
        issueNumber,
        (resolution.replyMessage || "Diskusi diterima.") + fallbackNotice
      );
      return;
    }

    // ACTION TYPE 2: UPDATE_PR (Append commits to active PR branch - NO DUPLICATE PR)
    if (resolution.actionType === "UPDATE_PR" && isPullRequest && activeBranchName) {
      console.log(`[Task] Appending commits to existing PR branch: ${activeBranchName}...`);

      if (!resolution.files || resolution.files.length === 0) {
        await githubService.postIssueComment(
          octokit,
          owner,
          repo,
          issueNumber,
          (resolution.replyMessage || "Tidak ada perubahan file yang diperlukan.") + fallbackNotice
        );
        return;
      }

      await githubService.appendCommitToExistingBranch({
        octokit,
        owner,
        repo,
        branchName: activeBranchName,
        baseCommitSha: baseCommitSha!,
        commitMessage: `chore(ai): apply review iteration from PR #${issueNumber}`,
        files: resolution.files,
      });

      const filesListMarkdown = resolution.files
        .map((f) => `- \`${f.path}\` (${f.action})`)
        .join("\n");

      await githubService.postIssueComment(
        octokit,
        owner,
        repo,
        issueNumber,
        `✅ **Revisi Ditambahkan ke PR!**\n\n${resolution.replyMessage}\n\n**File yang Diperbarui:**\n${filesListMarkdown}\n\n*Commit telah ditambahkan langsung ke branch \`${activeBranchName}\`.*` +
          fallbackNotice
      );
      return;
    }

    // ACTION TYPE 3: CREATE_PR (New feature/fix on Issue -> Isolated New Branch + New PR)
    console.log(`[Task] Creating isolated feature branch and opening new PR...`);
    if (!resolution.files || resolution.files.length === 0) {
      await githubService.postIssueComment(
        octokit,
        owner,
        repo,
        issueNumber,
        `⚠️ AI menganalisis task tetapi tidak mendeteksi file yang perlu dibuat/diubah.` + fallbackNotice
      );
      return;
    }

    const prResult = await githubService.createFeatureBranchAndPR({
      octokit,
      owner,
      repo,
      baseBranch: baseBranch!,
      baseCommitSha: baseCommitSha!,
      suggestedBranchName: resolution.branchName || `ai/task-${issueNumber}`,
      commitMessage: `feat(ai): ${resolution.prTitle || issueTitle} (closes #${issueNumber})`,
      files: resolution.files,
      prTitle: `[AI] ${resolution.prTitle || issueTitle}`,
      prBody: (resolution.summary || resolution.replyMessage) + fallbackNotice,
      issueNumber,
    });

    await githubService.postIssueComment(
      octokit,
      owner,
      repo,
      issueNumber,
      `✅ **Implementasi Selesai!**\n\n- **Branch Baru**: \`${prResult.branchName}\`\n- **Target Base**: \`${baseBranch}\`\n- **Engine**: \`${resolution.modelUsed}\`\n- **Pull Request**: [#${prResult.prNumber} (${resolution.prTitle || issueTitle})](${prResult.prUrl})\n\n**Ringkasan:**\n${resolution.summary || resolution.replyMessage}` +
        fallbackNotice
    );
  } catch (error: any) {
    console.error("[Conversational Task Error]", error);
    try {
      const githubService = getGitHubService();
      const octokit = await githubService.getInstallationOctokit(installationId);
      await githubService.postIssueComment(
        octokit,
        owner,
        repo,
        issueNumber,
        `❌ **Gagal menjalankan otomasi AI:**\n\`\`\`\n${error?.message || error}\n\`\`\`\n\n*Silakan periksa kembali pesan error di atas atau coba beberapa saat lagi.*`
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
        mode: "conversational-pair-programmer",
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

    // Process webhook with signature verification
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
