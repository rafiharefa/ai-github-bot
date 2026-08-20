import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

export interface FileChange {
  path: string;
  content: string;
  action: "create" | "update" | "delete";
}

export type ActionType = "CHAT_REPLY" | "CREATE_PR" | "UPDATE_PR";

export interface ThreadMessage {
  author: string;
  content: string;
  createdAt?: string;
  isBot?: boolean;
}

export interface AIResolution {
  actionType: ActionType;
  replyMessage: string;
  prTitle?: string;
  summary?: string;
  branchName?: string;
  files: FileChange[];
  modelUsed: string;
  fallbackWarnings?: string[];
}

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private primaryModelName: string;

  constructor(apiKey: string, modelName = "gemini-3.1-pro") {
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined in environment variables.");
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.primaryModelName = modelName;
  }

  async processConversationalTask(params: {
    repoName: string;
    issueTitle: string;
    issueBody: string;
    threadHistory: ThreadMessage[];
    isPullRequest: boolean;
    activeBranchName?: string;
    repoStructure: string[];
    contextFiles: { path: string; content: string }[];
  }): Promise<AIResolution> {
    const fallbackChain = Array.from(
      new Set([
        "gemini-3.1-pro",
        "gemini-3.1-flash",
        this.primaryModelName,
        "gemini-2.0-pro-exp-02-05",
        "gemini-2.0-flash",
        "gemini-1.5-pro",
        "gemini-1.5-flash",
      ])
    );

    const threadTranscript = params.threadHistory
      .map((msg) => `[${msg.isBot ? "ASSISTANT (@bot)" : `USER (@${msg.author})`}]:\n${msg.content}`)
      .join("\n\n---\n\n");

    const prompt = `
Repository: ${params.repoName}
Thread Context: ${params.isPullRequest ? `Pull Request (Active Branch: ${params.activeBranchName || "PR"})` : "Issue Thread"}
Thread Title: ${params.issueTitle}

Initial Problem / Task:
${params.issueBody}

Conversation History (Chronological):
${threadTranscript || "(No previous comments)"}

Repository Structure (Key Files):
${params.repoStructure.slice(0, 150).join("\n")}

Existing Key File Contents & Architecture Rules:
${params.contextFiles
  .map(
    (file) => `
--- File: ${file.path} ---
${file.content}
`
  )
  .join("\n")}

CRITICAL ENGINEERING DIRECTIVES:
1. Intent Classification:
   - If the user is asking questions, discussing ideas, asking for an explanation, or reviewing architecture -> Return actionType "CHAT_REPLY", provide an in-depth, expert explanation in "replyMessage", and keep "files" array EMPTY [].
   - If the user explicitly asks to code, build, fix, refactor, or create files:
     - On a regular Issue: Return actionType "CREATE_PR", generate complete file implementations in "files", generate a clear "prTitle", write a detailed markdown "summary" with conviction score, and suggest a "branchName" (e.g. "ai/issue-...").
     - On an active PR: Return actionType "UPDATE_PR", return only modified files in "files", and write an update summary in "replyMessage".
2. Code Synthesis Standards:
   - Write PRODUCTION-READY, type-safe, bug-free code.
   - Adhere strictly to Clean Architecture (separation of Domain, Data, Presentation layers).
   - Follow existing repository conventions, styling, import aliases (e.g. '@/...'), and state management (Riverpod/BLoC/React hooks).
   - NEVER truncate files with placeholders like "// ... rest of code". Provide 100% complete, compilable file contents.
3. Conviction Scoring:
   - Always append a conviction score in your explanation: "[Conviction: High/Medium/Low] - [Rationale]".
`;

    const fallbackWarnings: string[] = [];
    let lastError: any = null;

    for (const modelName of fallbackChain) {
      try {
        console.log(`[Gemini Engine] Processing task with official model: ${modelName}...`);
        const model = this.genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: SchemaType.OBJECT,
              properties: {
                actionType: {
                  type: SchemaType.STRING,
                  format: "enum",
                  enum: ["CHAT_REPLY", "CREATE_PR", "UPDATE_PR"],
                  description: "CHAT_REPLY for Q&A discussion, CREATE_PR for new features on issues, UPDATE_PR for revising active PRs",
                },
                replyMessage: {
                  type: SchemaType.STRING,
                  description: "Markdown response message for chat or PR update summary",
                },
                prTitle: {
                  type: SchemaType.STRING,
                  description: "Conventional commit PR title (if CREATE_PR)",
                },
                summary: {
                  type: SchemaType.STRING,
                  description: "Detailed summary of code changes with conviction score (if CREATE_PR)",
                },
                branchName: {
                  type: SchemaType.STRING,
                  description: "Suggested branch name starting with ai/ (if CREATE_PR)",
                },
                files: {
                  type: SchemaType.ARRAY,
                  items: {
                    type: SchemaType.OBJECT,
                    properties: {
                      path: { type: SchemaType.STRING, description: "Relative file path from repository root" },
                      content: { type: SchemaType.STRING, description: "Full complete compilable file content" },
                      action: {
                        type: SchemaType.STRING,
                        format: "enum",
                        enum: ["create", "update", "delete"],
                      },
                    },
                    required: ["path", "content", "action"],
                  },
                },
              },
              required: ["actionType", "replyMessage", "files"],
            },
          },
          systemInstruction: `You are a Principal Software Architect and elite Pair Programming Intelligence.
You analyze user codebase repositories, reason through architecture, and synthesize elegant, production-grade code.

STRICT INVARIANTS:
1. Pure Chat Precision: When the user asks conceptual questions, asks for advice, or discusses ideas, ONLY answer with "CHAT_REPLY" and NEVER output files.
2. Clean Architecture & Zero Race Conditions: Maintain strict layer boundaries, eliminate async race conditions, ensure strict type safety, and apply Apple-level minimalist UI.
3. Complete Implementations: Output full, complete file contents ready for direct git commit without placeholders.
4. Conviction Scoring: In technical explanations and code summaries, include "[Conviction: High/Medium/Low] - [Rationale]".
5. Target Branch Invariant: If a 'dev' or 'development' branch exists in the repository, all Pull Requests must target 'dev'/'development' instead of main/master.`,
        });

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const parsed: AIResolution = JSON.parse(text);

        // Attach telemetry
        parsed.modelUsed = modelName;
        if (fallbackWarnings.length > 0) {
          parsed.fallbackWarnings = fallbackWarnings;
        }

        // Safety fallback for branch name on CREATE_PR
        if (parsed.actionType === "CREATE_PR" && (!parsed.branchName || !parsed.branchName.startsWith("ai/"))) {
          const sanitizedSlug = params.issueTitle
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "")
            .slice(0, 30);
          parsed.branchName = `ai/${sanitizedSlug || "feature"}-${Date.now()}`;
        }

        console.log(`[Gemini Engine] Task successfully processed with actionType: ${parsed.actionType} using model: ${modelName}`);
        return parsed;
      } catch (err: any) {
        const errorSummary = err?.message || String(err);
        console.warn(`[Gemini Engine] Model ${modelName} failed:`, errorSummary);
        fallbackWarnings.push(`Model \`${modelName}\` failed (${errorSummary.slice(0, 160)})`);
        lastError = err;
      }
    }

    const aggregatedError = new Error(
      `Semua model Gemini dalam fallback chain gagal.\n\nRincian Kegagalan:\n${fallbackWarnings.join("\n")}\n\nTerakhir: ${lastError?.message || lastError}`
    );
    throw aggregatedError;
  }
}
