import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

export interface FileChange {
  path: string;
  content: string;
  action: "create" | "update" | "delete";
}

export interface AIResolution {
  prTitle: string;
  summary: string;
  branchName: string;
  files: FileChange[];
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

  async generateCodeChanges(params: {
    repoName: string;
    issueTitle: string;
    issueBody: string;
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

    const prompt = `
Repository: ${params.repoName}
Issue/Task Title: ${params.issueTitle}

Task Details / Instructions:
${params.issueBody}

Repository Structure (Key Files):
${params.repoStructure.slice(0, 100).join("\n")}

Existing Key File Contents:
${params.contextFiles
  .map(
    (file) => `
--- File: ${file.path} ---
${file.content}
`
  )
  .join("\n")}

Analyze the task requirements, determine the exact files to create, update, or delete, and return the complete structured output.
`;

    let lastError: any = null;

    for (const modelName of fallbackChain) {
      try {
        console.log(`[Gemini Engine] Attempting code generation with model: ${modelName}...`);
        const model = this.genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: SchemaType.OBJECT,
              properties: {
                prTitle: { type: SchemaType.STRING, description: "Clear, conventional commit style PR title" },
                summary: { type: SchemaType.STRING, description: "Detailed Markdown summary of changes with Conviction score" },
                branchName: { type: SchemaType.STRING, description: "Git branch name starting with ai/ followed by concise slug" },
                files: {
                  type: SchemaType.ARRAY,
                  items: {
                    type: SchemaType.OBJECT,
                    properties: {
                      path: { type: SchemaType.STRING, description: "Relative file path from repository root" },
                      content: { type: SchemaType.STRING, description: "Full new content of the file. If action is delete, can be empty string." },
                      action: {
                        type: SchemaType.STRING,
                        format: "enum",
                        enum: ["create", "update", "delete"],
                        description: "create, update, or delete",
                      },
                    },
                    required: ["path", "content", "action"],
                  },
                },
              },
              required: ["prTitle", "summary", "branchName", "files"],
            },
          },
          systemInstruction: `You are an elite Autonomous AI Software Architect and Principal Engineer.
Your task is to analyze user tasks/issues for GitHub repositories, synthesize high-quality code changes, and provide full file implementations.

STRICT INVARIANTS:
1. Architectural Discipline: Follow Clean Architecture, strict separation of concerns, and strict type safety.
2. No Race Conditions: Ensure all asynchronous operations, database calls, and UI state mutations are properly protected against race conditions.
3. Apple-Level UI Minimalism (for Frontend/Flutter): Spacious padding, natural elevation, zero cluttered borders. Reusable widgets extracted into structured StatelessWidgets.
4. Complete File Contents: Always provide the COMPLETE file content for any modified or newly created file. Never truncate with comments like "// ... rest of the code".
5. Branching Rule: Always generate a new branch name starting with "ai/" (e.g., "ai/issue-12-add-auth-flow").
6. Summary Formatting: Include a Conviction Score in the summary: "[Conviction: High/Medium/Low] - [Rationale]".`,
        });

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const parsed: AIResolution = JSON.parse(text);

        // Enforce branch name safety
        if (!parsed.branchName || !parsed.branchName.startsWith("ai/")) {
          const sanitizedSlug = params.issueTitle
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "")
            .slice(0, 30);
          parsed.branchName = `ai/${sanitizedSlug || "automated-fix"}-${Date.now()}`;
        }

        console.log(`[Gemini Engine] Generation succeeded using model: ${modelName}`);
        return parsed;
      } catch (err: any) {
        console.warn(`[Gemini Engine] Model ${modelName} failed:`, err?.message || err);
        lastError = err;
        // Continue to next model in fallback chain
      }
    }

    throw lastError || new Error("All Gemini models in fallback chain failed.");
  }
}
