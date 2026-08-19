# AI Autonomous Developer (GitHub App Engine)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Frafiharefa%2Fai-github-bot&env=GEMINI_API_KEY,GEMINI_MODEL,GITHUB_APP_ID,GITHUB_WEBHOOK_SECRET,BOT_TRIGGER_NAME,GITHUB_PRIVATE_KEY&envDescription=Fill%20in%20your%20Google%20Gemini%20API%20Key%20and%20GitHub%20App%20Credentials&project-name=my-ai-github-bot&repo-name=ai-github-bot)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Powered by Gemini](https://img.shields.io/badge/AI%20Engine-Gemini%203.7%20%2F%202.5-orange.svg)](https://aistudio.google.com/)

An open-source, serverless AI Software Engineering bot for GitHub. Connect your GitHub account with **Google Gemini (Gemini 3.7 / 2.5 / 2.0)** to synthesize code, enforce Clean Architecture, isolate git branches, and open automated Pull Requests 24/7 directly from GitHub Issues or comments.

---

## ⚡ 1-Click Quickstart (Self-Host with Your Own Key)

Anyone can deploy and host their own private or public instance in under **3 minutes** using their own **Free Tier** Google Gemini API Key and Vercel account ($0/month).

### Step 1: Get a Free Google Gemini API Key
1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Click **Get API key** $\to$ **Create API key** (Free tier provides 1,500 requests/day).

---

### Step 2: Register your GitHub App
1. Go to [GitHub App Registration](https://github.com/settings/apps/new).
2. Fill in the basics:
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
   - Click **Install App** on the left menu $\to$ Install to your account with **All repositories** (or select specific repos).

---

### Step 3: Deploy to Vercel in 1-Click

Click the button below to deploy this engine directly to your Vercel account:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Frafiharefa%2Fai-github-bot&env=GEMINI_API_KEY,GEMINI_MODEL,GITHUB_APP_ID,GITHUB_WEBHOOK_SECRET,BOT_TRIGGER_NAME,GITHUB_PRIVATE_KEY&envDescription=Fill%20in%20your%20Google%20Gemini%20API%20Key%20and%20GitHub%20App%20Credentials&project-name=my-ai-github-bot&repo-name=ai-github-bot)

Fill in the environment variables during deployment:
- `GEMINI_API_KEY`: Your Gemini API Key from Google AI Studio.
- `GEMINI_MODEL`: `gemini-3.7-flash` (or `gemini-2.5-flash`).
- `GITHUB_APP_ID`: App ID from Step 2.
- `GITHUB_WEBHOOK_SECRET`: Webhook secret you set in Step 2.
- `BOT_TRIGGER_NAME`: `@my-bot-name` (or `@rafiharefa-bot`).
- `GITHUB_PRIVATE_KEY`: Open the downloaded `.pem` file in a text editor, copy and paste the entire content.

---

### Step 4: Update Webhook URL in GitHub App
1. Copy your live Vercel domain (e.g. `https://my-ai-github-bot.vercel.app`).
2. Go back to GitHub $\to$ **Settings** $\to$ **Developer settings** $\to$ **GitHub Apps** $\to$ [Your App].
3. Set **Webhook URL** to:
   ```text
   https://my-ai-github-bot.vercel.app/api/webhook
   ```
4. Click **Save changes**.

---

## 🎯 Usage Across Your Repositories

Once installed, trigger the bot from any repository on your desktop or mobile phone:

### Option A: Issue Command
Add a comment on any issue:
```text
/ai develop Add unit tests for auth repository and handle edge cases for network failures
```

### Option B: New Issue Trigger
Create a new Issue with title prefix `[AI]` or tag it with label `ai-task`:
- **Title**: `[AI] Refactor navigation layout`
- **Description**: Detailed requirements of what needs to be changed.

The bot will automatically:
1. Acknowledge the issue with a comment.
2. Create an isolated branch (`ai/issue-...`).
3. Synthesize the changes and create a Git tree.
4. Open a clean Pull Request with full diff documentation and conviction scores.

---

## 🛡️ Core Invariants

- **Isolated Branching Guarantee:** The bot never writes directly to `main`, `master`, or active working branches.
- **Multi-Model Fallback:** Automatically switches between `gemini-3.7-flash` $\to$ `gemini-2.5-flash` $\to$ `gemini-2.0-flash` $\to$ `gemini-1.5-pro` on demand spikes (503/429).
- **Clean Architecture & Concurrency Safety:** Enforces strict typing, domain layer separation, and eliminates race conditions.

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
