import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import { FileChange, ThreadMessage } from "./gemini.js";

const CustomApp = App.defaults({
  Octokit: Octokit,
});

export class GitHubService {
  private app: InstanceType<typeof CustomApp>;

  constructor(appId: string, privateKey: string) {
    this.app = new CustomApp({
      appId,
      privateKey,
    });
  }

  async getInstallationOctokit(installationId: number): Promise<Octokit> {
    const octokit = (await this.app.getInstallationOctokit(installationId)) as unknown as Octokit;
    return octokit;
  }

  async getRepoInstallationOctokit(owner: string, repo: string): Promise<{ octokit: Octokit; installationId: number }> {
    const { data: installation } = await this.app.octokit.rest.apps.getRepoInstallation({
      owner,
      repo,
    });
    const octokit = await this.getInstallationOctokit(installation.id);
    return { octokit, installationId: installation.id };
  }

  async listAccessibleRepositories(owner: string): Promise<{ name: string; full_name: string; private: boolean; default_branch: string }[]> {
    try {
      const { data: installation } = await this.app.octokit.rest.apps.getUserInstallation({
        username: owner,
      });
      const octokit = await this.getInstallationOctokit(installation.id);
      const { data: repoData } = await octokit.rest.apps.listReposAccessibleToInstallation({
        per_page: 50,
      });

      return repoData.repositories.map((r) => ({
        name: r.name,
        full_name: r.full_name,
        private: r.private,
        default_branch: r.default_branch,
      }));
    } catch (error) {
      console.warn("[GitHub Service] Failed to list accessible repositories:", error);
      return [];
    }
  }

  async getThreadHistory(
    octokit: Octokit,
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<ThreadMessage[]> {
    try {
      const { data: comments } = await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: issueNumber,
        per_page: 50,
      });

      return comments.map((c) => ({
        author: c.user?.login || "anonymous",
        content: c.body || "",
        createdAt: c.created_at,
        isBot: c.user?.type === "Bot" || (c.user?.login || "").includes("[bot]"),
      }));
    } catch (err) {
      console.warn("[GitHub Service] Failed to list comments for thread history:", err);
      return [];
    }
  }

  async getRepositoryContext(
    octokit: Octokit,
    owner: string,
    repo: string,
    targetBranch?: string
  ): Promise<{
    defaultBranch: string;
    latestCommitSha: string;
    fileList: string[];
    contextFiles: { path: string; content: string }[];
  }> {
    // 1. Get Repo Details
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
    const branchToUse = targetBranch || repoData.default_branch;

    // 2. Get latest commit SHA on target branch
    const { data: refData } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branchToUse}`,
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
            ref: branchToUse,
          });

          if ("content" in fileData && fileData.encoding === "base64") {
            const decoded = Buffer.from(fileData.content, "base64").toString("utf-8");
            contextFiles.push({
              path: filePath,
              content: decoded.slice(0, 15000),
            });
          }
        } catch {
          // Ignore read errors on individual context files
        }
      }
    }

    return {
      defaultBranch: branchToUse,
      latestCommitSha,
      fileList,
      contextFiles,
    };
  }

  async getPullRequestInfo(
    octokit: Octokit,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<{
    branchName: string;
    latestCommitSha: string;
    baseBranch: string;
    title: string;
    isOpen: boolean;
  }> {
    const { data: prData } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    return {
      branchName: prData.head.ref,
      latestCommitSha: prData.head.sha,
      baseBranch: prData.base.ref,
      title: prData.title,
      isOpen: prData.state === "open",
    };
  }

  /**
   * Appends commits directly to an existing Pull Request branch.
   * Prevents creating duplicate PRs when iterating on active work.
   */
  async appendCommitToExistingBranch(params: {
    octokit: Octokit;
    owner: string;
    repo: string;
    branchName: string;
    baseCommitSha: string;
    commitMessage: string;
    files: FileChange[];
  }): Promise<{ commitSha: string }> {
    const { octokit, owner, repo, branchName, baseCommitSha, commitMessage, files } = params;

    // 1. Create Blobs
    const treeItems: { path: string; mode: "100644"; type: "blob"; sha?: string | null }[] = [];

    for (const file of files) {
      if (file.action === "delete") {
        treeItems.push({
          path: file.path,
          mode: "100644",
          type: "blob",
          sha: null,
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

    // 2. Create Tree
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

    // 3. Create Commit
    const { data: newCommit } = await octokit.rest.git.createCommit({
      owner,
      repo,
      message: commitMessage,
      tree: newTree.sha,
      parents: [baseCommitSha],
    });

    // 4. Update Branch Ref
    await octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${branchName}`,
      sha: newCommit.sha,
    });

    return { commitSha: newCommit.sha };
  }

  /**
   * INVARIANT: ALWAYS creates a new dedicated branch first when starting new feature.
   * Never commits to default branch directly.
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

    const timestamp = Date.now();
    let branchName = params.suggestedBranchName.startsWith("ai/")
      ? `${params.suggestedBranchName}-${timestamp.toString().slice(-4)}`
      : `ai/${params.suggestedBranchName}-${timestamp.toString().slice(-4)}`;

    branchName = branchName.replace(/[^a-zA-Z0-9_\-\/]/g, "-");

    const treeItems: { path: string; mode: "100644"; type: "blob"; sha?: string | null }[] = [];

    for (const file of files) {
      if (file.action === "delete") {
        treeItems.push({
          path: file.path,
          mode: "100644",
          type: "blob",
          sha: null,
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

    const { data: newCommit } = await octokit.rest.git.createCommit({
      owner,
      repo,
      message: params.commitMessage,
      tree: newTree.sha,
      parents: [baseCommitSha],
    });

    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: newCommit.sha,
    });

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
