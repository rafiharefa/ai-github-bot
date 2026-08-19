# AI Autonomous Developer & Conversational Pair Programmer

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Frafiharefa%2Fai-github-bot&env=GEMINI_API_KEY,GEMINI_MODEL,GITHUB_APP_ID,GITHUB_WEBHOOK_SECRET,BOT_TRIGGER_NAME,GITHUB_PRIVATE_KEY,TELEGRAM_BOT_TOKEN,TELEGRAM_ALLOWED_USER_ID,GITHUB_OWNER&envDescription=Fill%20in%20your%20Google%20Gemini%20API%20Key%2C%20GitHub%20App%2C%20and%20Telegram%20Credentials&project-name=my-ai-github-bot&repo-name=ai-github-bot)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Powered by Gemini](https://img.shields.io/badge/AI%20Engine-Gemini%203.7%20%2F%202.5-orange.svg)](https://aistudio.google.com/)
[![Telegram Interface](https://img.shields.io/badge/Mobile-Telegram%20Bot%20Ready-2CA5E0.svg)](https://core.telegram.org/bots)

An open-source, serverless AI Software Engineering Agent & Conversational Pair Programmer for GitHub and Telegram. Powered by **Google Gemini (Gemini 3.7 / 2.5 / 2.0)**, **Vercel Serverless Runtime**, and **GitHub Apps API (Octokit)** to synthesize code, enforce Clean Architecture, maintain multi-turn discussion memory, and manage automated Pull Requests 24/7 directly from your browser, GitHub mobile app, or Telegram chat.

---

## 🚀 Key Capabilities

1. **Claude Code-Style Multi-Turn Conversations:**
   - **Q&A / Discussion Mode (`CHAT_REPLY`):** Ask conceptual or architectural questions without triggering any unwanted Git branches or file changes.
   - **Continuous PR Iteration (`UPDATE_PR`):** Comment on active Pull Requests to request code revisions; the bot appends commits directly to the existing PR branch with **zero duplicate PRs**.
   - **New Feature Development (`CREATE_PR`):** Starts from an Issue, generates code, creates an isolated branch (`ai/...`), and opens a new Pull Request.
2. **Mobile Telegram Interface:**
   - Manage, inspect, and code across all your GitHub repositories directly from your Telegram app.
   - Whitelist-protected access to ensure only authorized users can trigger actions.
3. **Resilient Multi-Model Fallback Ladder:**
   - Automatically switches `gemini-3.7-flash` $\to$ `gemini-2.5-flash` $\to$ `gemini-2.0-flash` $\to$ `gemini-1.5-pro` on demand spikes (503/429) to guarantee 99.99% uptime.
4. **100% Free-Tier Architecture:**
   - Runs on Google AI Studio Free Tier (1,500 requests/day) and Vercel Serverless Compute ($0/month).

---

## ⚡ 1-Click Quickstart (Self-Host with Your Own Keys)

### Step 1: Get a Free Google Gemini API Key
1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Click **Get API key** $\to$ **Create API key** (Free tier provides 1,500 requests/day).

---

### Step 2: Register your GitHub App
1. Go to [GitHub App Registration](https://github.com/settings/apps/new).
2. Fill in:
   - **GitHub App name**: `my-ai-developer-bot` (or any unique name).
   - **Homepage URL**: Your GitHub profile URL.
   - **Webhook URL**: Temporary URL (e.g. `https://example.com/api/webhook`), you will update this after deploying to Vercel.
   - **Webhook secret**: Generate a secure secret string (e.g. `my_custom_secret_12345`).
3. Set **Permissions**:
   - `Repository permissions` $\to$ **Contents**: `Read and write`
   - `Repository permissions` $\to$ **Issues**: `Read and write`
   - `Repository permissions` $\to$ **Pull requests**: `Read and write`
4. Set **Subscribe to events**:
   - Check `[x] Issues`
   - Check `[x] Issue comment`
5. Click **Create GitHub App**.
6. On your app page:
   - Note the **App ID**.
   - Click **Generate a private key** (downloads a `.pem` file).
   - Click **Install App** on the left menu $\to$ Install to your account with **All repositories**.

---

### Step 3 (Optional): Create Telegram Bot
1. Open Telegram and message **`@BotFather`**.
2. Send `/newbot` and follow the prompts to get your **HTTP API Token**.
3. Open **`@userinfobot`** on Telegram and note your **numeric User ID** (for whitelist authorization).

---

### Step 4: Deploy to Vercel in 1-Click

Click the button below to deploy this engine directly to your Vercel account:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Frafiharefa%2Fai-github-bot&env=GEMINI_API_KEY,GEMINI_MODEL,GITHUB_APP_ID,GITHUB_WEBHOOK_SECRET,BOT_TRIGGER_NAME,GITHUB_PRIVATE_KEY,TELEGRAM_BOT_TOKEN,TELEGRAM_ALLOWED_USER_ID,GITHUB_OWNER&envDescription=Fill%20in%20your%20Google%20Gemini%20API%20Key%2C%20GitHub%20App%2C%20and%20Telegram%20Credentials&project-name=my-ai-github-bot&repo-name=ai-github-bot)

#### Environment Variables Reference:

| Variable | Required | Description | Example |
| :--- | :---: | :--- | :--- |
| `GEMINI_API_KEY` | **Yes** | Google AI Studio Gemini API Key | `AIzaSy...` |
| `GEMINI_MODEL` | No | Primary reasoning model (Default: `gemini-3.7-flash`) | `gemini-3.7-flash` |
| `GITHUB_APP_ID` | **Yes** | GitHub App ID | `123456` |
| `GITHUB_WEBHOOK_SECRET` | **Yes** | Webhook secret string set in GitHub App | `my_secret_key` |
| `GITHUB_PRIVATE_KEY` | **Yes** | RSA `.pem` private key content or Base64 string | `-----BEGIN RSA...` |
| `BOT_TRIGGER_NAME` | No | Bot mention trigger in issues (Default: `@rafiharefa-bot`) | `@my-bot` |
| `GITHUB_OWNER` | No | Default GitHub username | `rafiharefa` |
| `TELEGRAM_BOT_TOKEN` | No | Telegram Bot HTTP API Token from `@BotFather` | `789123:AAHk...` |
| `TELEGRAM_ALLOWED_USER_ID` | No | Numeric Telegram user ID from `@userinfobot` | `102938475` |

---

### Step 5: Connect Webhooks

1. **GitHub App Webhook:**
   - In GitHub App Settings, set **Webhook URL** to:
     ```text
     https://<your-vercel-domain>.vercel.app/api/webhook
     ```
2. **Telegram Webhook (If Telegram Bot is configured):**
   - Open this URL once in your browser to automatically register the Telegram webhook:
     ```text
     https://<your-vercel-domain>.vercel.app/api/telegram?setWebhook=1
     ```

---

## 🎯 Usage Workflows

### A. On GitHub Issues & Pull Requests

1. **Ask Architecture Questions (Chat Mode):**
   ```text
   /ai How is state management organized in this repository?
   ```
   *Bot replies directly in the comments explaining the architecture without modifying any files.*

2. **Request New Code (Build Mode):**
   ```text
   /ai Implement a responsive hero banner component in src/components/Hero.tsx
   ```
   *Bot creates a new branch `ai/issue-...` and opens a Pull Request.*

3. **Iterate on Open PRs (Refining Mode):**
   Comment on the created PR:
   ```text
   /ai Add unit tests for the hero component and ensure accessibility labels are present
   ```
   *Bot appends new commits directly to the active PR branch.*

---

### B. On Telegram Mobile Chat

1. **List Repositories:**
   ```text
   /repos
   ```
2. **Target Specific Repository:**
   ```text
   /repo vanderandco explain the dynamic gallery layout
   ```
3. **Trigger Code Development via Telegram:**
   ```text
   /repo vanderandco update README.md with system architecture diagram
   ```
   *Bot generates code, commits, opens a Pull Request on GitHub, and returns the clickable PR link in Telegram.*

---

## 🛡️ Core Engineering Invariants

- **The Isolated Branch Invariant:** The bot is structurally prevented from writing directly to `main` or active default branches.
- **Thread History Memory:** Ingests previous comments for continuous multi-turn dialogue.
- **Zero-Clone Virtual Git Tree:** Manipulates Git Blobs and Trees directly via Octokit in under 800ms.
- **Clean Architecture & No Race Conditions:** System prompts strictly enforce domain decoupling, concurrency safety, and Apple-level UI minimalism.

---

## 📄 License

Distributed under the [MIT License](LICENSE). Free for personal and commercial use.
