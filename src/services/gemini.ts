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

  constructor(apiKey: string, modelName = "gemini-3.7-flash") {
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
        this.primaryModelName,
        "gemini-2.5-flash",
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

Initial Problem / Topic:
${params.issueBody}

Conversation History (Chronological):
${threadTranscript || "(No previous comments)"}

Repository Structure (Key Files):
${params.repoStructure.slice(0, 120).join("\n")}

Existing Key File Contents:
${params.contextFiles
  .map(
    (file) => `
--- File: ${file.path} ---
${file.content}
`
  )
  .join("\n")}

USER INTENT & ACTION TYPE RULES:
1. "CHAT_REPLY": If the user is asking a question, discussing concepts, asking for an explanation, asking why a decision was made, reviewing architecture, or NOT asking to generate code/files -> Set actionType to "CHAT_REPLY", provide a clear, helpful, high-conviction answer in "replyMessage", and keep "files" array EMPTY []. DO NOT create branches or PRs!
2. "CREATE_PR": If the user is in a regular Issue thread and explicitly requests implementing code, creating files, adding features, or fixing bugs -> Set actionType to "CREATE_PR", provide the complete files in "files", generate a concise conventional "prTitle", write a markdown "summary", and specify a new "branchName" (format "ai/issue-...").
3. "UPDATE_PR": If the user is commenting inside an active Pull Request thread requesting revisions, fixes, or additional code -> Set actionType to "UPDATE_PR", provide ONLY the updated/new files in "files", write a markdown explanation in "replyMessage" detailing what was updated.

Determine the user's latest intent from the last message in the thread, synthesize the response, and return the structured JSON output.
`;

    const fallbackWarnings: string[] = [];
    let lastError: any = null;

    for (const modelName of fallbackChain) {
      try {
        console.log(`[Gemini Engine] Processing conversational task with model: ${modelName}...`);
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
                  description: "CHAT_REPLY for conversational Q&A without code, CREATE_PR for new features on issues, UPDATE_PR for revising active PRs",
                },
                replyMessage: {
                  type: SchemaType.STRING,
                  description: "Markdown formatted response message for chat or PR update summary",
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
                      content: { type: SchemaType.STRING, description: "Full complete file content" },
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
          systemInstruction: `You are an elite Autonomous AI Software Architect and Interactive Pair Programmer (like Claude Code).

STRICT INVARIANTS:
1. Conversational Precision: When the user asks conceptual questions, asks for advice, or discusses ideas, ONLY answer with "CHAT_REPLY" and NEVER output files. Do not modify the repo unless explicitly told to build/code.
2. Clean Architecture & No Race Conditions: When writing code, maintain strict architectural layer decoupling, avoid race conditions, and use Apple-level UI minimalism.
3. Complete Code: Never output placeholders or truncated comments like "// ... existing code". Always return the full, valid file contents.
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
        fallbackWarnings.push(`⚠️ Model \`${modelName}\` gagal (${errorSummary.slice(0, 180)}...)`);
        lastError = err;
      }
    }

    const aggregatedError = new Error(
      `Semua model Gemini dalam fallback chain gagal.\n\nRincian Kegagalan:\n${fallbackWarnings.join("\n")}\n\nTerakhir: ${lastError?.message || lastError}`
    );
    throw aggregatedError;
  }
}
