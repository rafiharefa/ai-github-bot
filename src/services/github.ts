import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import { FileChange } from "./gemini.js";

export class GitHubService {
  private app: App;

  constructor(appId: string, privateKey: string) {
    this.app = new App({
      appId,
      privateKey,
    });
  }

  async getInstallationOctokit(installationId: number): Promise<Octokit> {
    const octokit = (await this.app.getInstallationOctokit(installationId)) as unknown as Octokit;
    return octokit;
  }

  async getRepositoryContext(
    octokit: Octokit,
    owner: string,
    repo: string
  ): Promise<{
    defaultBranch: string;
    latestCommitSha: string;
    fileList: string[];
    contextFiles: { path: string; content: string }[];
  }> {
    // 1. Get Repo Details
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
    const defaultBranch = repoData.default_branch;

    // 2. Get latest commit SHA on default branch
    const { data: refData } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${defaultBranch}`,
    });
    const latestCommitSha = refData.object.sha;

    // 3. Get file tree
    const { data: treeData } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: latestCommitSha,
      recursive: "true",
    });

    const fileList = (treeData.tree || [])
      .filter((item) => item.type === "blob")
      .map((item) => item.path || "");

    // 4. Fetch essential context files (Rules, Architecture, Configs)
    const contextCandidatePatterns = [
      "AGENTS.md",
      "README.md",
      "package.json",
      "pubspec.yaml",
      "tsconfig.json",
      "CLAUDE.md",
      "financial_tracker_agent_rules.md",
    ];

    const contextFiles: { path: string; content: string }[] = [];

    for (const filePath of fileList) {
      const isCandidate = contextCandidatePatterns.some((pattern) =>
        filePath.toLowerCase().endsWith(pattern.toLowerCase())
      );

      if (isCandidate && contextFiles.length < 8) {
        try {
          const { data: fileData } = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: filePath,
          });

          if ("content" in fileData && fileData.encoding === "base64") {
            const decoded = Buffer.from(fileData.content, "base64").toString("utf-8");
            contextFiles.push({
              path: filePath,
              content: decoded.slice(0, 15000), // Protect token limit per file
            });
          }
        } catch {
          // Ignore read errors on individual files
        }
      }
    }

    return {
      defaultBranch,
      latestCommitSha,
      fileList,
      contextFiles,
    };
  }

  /**
   * INVARIANT: ALWAYS creates a new dedicated branch first.
   * Never commits to default branch or existing branches.
   */
  async createFeatureBranchAndPR(params: {
    octokit: Octokit;
    owner: string;
    repo: string;
    baseBranch: string;
    baseCommitSha: string;
    suggestedBranchName: string;
    commitMessage: string;
    files: FileChange[];
    prTitle: string;
    prBody: string;
    issueNumber?: number;
  }): Promise<{ prUrl: string; prNumber: number; branchName: string }> {
    const { octokit, owner, repo, baseBranch, baseCommitSha, files, prTitle, prBody, issueNumber } = params;

    // 1. Ensure unique, clean new branch name
    const timestamp = Date.now();
    let branchName = params.suggestedBranchName.startsWith("ai/")
      ? `${params.suggestedBranchName}-${timestamp.toString().slice(-4)}`
      : `ai/${params.suggestedBranchName}-${timestamp.toString().slice(-4)}`;

    branchName = branchName.replace(/[^a-zA-Z0-9_\-\/]/g, "-");

    // 2. Create Blobs for files
    const treeItems: { path: string; mode: "100644"; type: "blob"; sha?: string | null }[] = [];

    for (const file of files) {
      if (file.action === "delete") {
        treeItems.push({
          path: file.path,
          mode: "100644",
          type: "blob",
          sha: null, // Deletes the file from git tree
        });
      } else {
        const { data: blobData } = await octokit.rest.git.createBlob({
          owner,
          repo,
          content: Buffer.from(file.content).toString("base64"),
          encoding: "base64",
        });

        treeItems.push({
          path: file.path,
          mode: "100644",
          type: "blob",
          sha: blobData.sha,
        });
      }
    }

    // 3. Create new Git Tree based on base commit
    const { data: baseCommitData } = await octokit.rest.git.getCommit({
      owner,
      repo,
      commit_sha: baseCommitSha,
    });

    const { data: newTree } = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: baseCommitData.tree.sha,
      tree: treeItems,
    });

    // 4. Create new Commit
    const { data: newCommit } = await octokit.rest.git.createCommit({
      owner,
      repo,
      message: params.commitMessage,
      tree: newTree.sha,
      parents: [baseCommitSha],
    });

    // 5. Create new branch reference
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: newCommit.sha,
    });

    // 6. Open Pull Request to base branch
    const { data: prData } = await octokit.rest.pulls.create({
      owner,
      repo,
      title: prTitle,
      body: `${prBody}\n\n---\n*Generated autonomously by **AI Developer Engine** from ${
        issueNumber ? `Issue #${issueNumber}` : "task trigger"
      }*`,
      head: branchName,
      base: baseBranch,
    });

    return {
      prUrl: prData.html_url,
      prNumber: prData.number,
      branchName,
    };
  }

  async postIssueComment(
    octokit: Octokit,
    owner: string,
    repo: string,
    issueNumber: number,
    body: string
  ): Promise<void> {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
  }
}
