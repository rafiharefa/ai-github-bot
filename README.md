# AI Autonomous Developer (GitHub App Engine)

Sistem otonom berbasis **GitHub App** yang menghubungkan seluruh repositori GitHub Anda dengan **Google Gemini API** (Gemini 2.0 Flash) untuk melakukan sintesis kode, pembuatan branch fitur baru secara terisolasi, dan pembukaan Pull Request secara otomatis 24/7.

---

## 🚀 Fitur Utama

- **Account-Wide Coverage:** Aktif secara otomatis di semua repositori saat ini dan masa depan di akun `@rafiharefa` tanpa perlu menyalin file konfigurasi berulang kali.
- **Isolated Branching Guarantee:** Selalu membuat branch baru terisolasi (format `ai/issue-...`), tidak pernah menulis langsung ke branch utama atau branch aktif.
- **Context-Aware:** Membaca struktur file, `AGENTS.md`, `README.md`, dan konfigurasi proyek terkait untuk memahami konteks arsitektur sebelum memodifikasi kode.
- **Auto Pull Request:** Otomatis menghasilkan commit dan membuka Pull Request lengkap dengan deskripsi perubahan dan *conviction score*.

---

## 🛠️ Panduan Setup Langkah Demi Langkah

### Langkah 1: Dapatkan Gemini API Key
1. Buka [Google AI Studio](https://aistudio.google.com/).
2. Login dengan akun Google One Anda.
3. Klik **Get API key** $\to$ **Create API key**.
4. Salin key tersebut untuk variabel `GEMINI_API_KEY`.

---

### Langkah 2: Registrasi GitHub App
1. Buka GitHub $\to$ **Settings** $\to$ **Developer settings** $\to$ **GitHub Apps** $\to$ [New GitHub App](https://github.com/settings/apps/new).
2. Isi data berikut:
   - **GitHub App name**: `rafiharefa-ai-bot` (atau nama unik pilihan Anda).
   - **Homepage URL**: URL profil GitHub Anda (misal `https://github.com/rafiharefa`).
   - **Webhook URL**: *(Isi sementara dengan `https://example.com/api/webhook`, akan diupdate setelah deploy ke Vercel)*.
   - **Webhook secret**: Buat string acak yang aman (contoh: `ai_secret_webhook_2026`).
3. **Repository permissions:**
   - **Contents**: `Read and write` (Untuk membaca file dan membuat branch/commit).
   - **Issues**: `Read and write` (Untuk membaca deskripsi dan membalas status).
   - **Pull requests**: `Read and write` (Untuk menerbitkan PR otomatis).
   - **Metadata**: `Read-only` (Default).
4. **Subscribe to events:**
   - Centang **Issues**.
   - Centang **Issue comment**.
5. Klik **Create GitHub App**.
6. Setelah dibuat:
   - Catat **App ID**.
   - Scroll ke bagian **Private keys** dan klik **Generate a private key**. File `.pem` akan terunduh.
7. Di menu sebelah kiri, klik **Install App** $\to$ Pilih akun Anda $\to$ Pilih opsi **All repositories** $\to$ Klik **Install**.

---

### Langkah 3: Deploy ke Vercel
1. Buat repository baru di GitHub Anda untuk project ini (misal: `https://github.com/rafiharefa/ai-github-bot`) dan push code ini.
2. Buka [Vercel Dashboard](https://vercel.com/) $\to$ **Add New** $\to$ **Project** $\to$ Import repository `ai-github-bot`.
3. Di bagian **Environment Variables**, tambahkan:
   - `GEMINI_API_KEY`: API key dari Google AI Studio.
   - `GITHUB_APP_ID`: App ID dari GitHub App Anda.
   - `GITHUB_WEBHOOK_SECRET`: Webhook secret yang Anda buat di Langkah 2.
   - `BOT_TRIGGER_NAME`: `@rafiharefa-bot`
   - `GITHUB_PRIVATE_KEY`: Buka file `.pem` yang telah diunduh dengan text editor, salin seluruh isinya (termasuk `-----BEGIN RSA PRIVATE KEY-----` dan `-----END RSA PRIVATE KEY-----`).
4. Klik **Deploy**.

---

### Langkah 4: Update Webhook URL di GitHub App
1. Salin domain URL Vercel yang telah selesai di-deploy (contoh: `https://ai-github-bot-xyz.vercel.app`).
2. Kembali ke GitHub $\to$ **Settings** $\to$ **Developer settings** $\to$ **GitHub Apps** $\to$ Edit App Anda.
3. Ubah **Webhook URL** menjadi:
   ```
   https://ai-github-bot-xyz.vercel.app/api/webhook
   ```
4. Klik **Save changes**.

---

## 💡 Cara Menggunakan di Semua Repository

Setelah terpasang, Anda dapat memicu AI di repositori mana saja:

### Cara A: Melalui Issue Baru
1. Buat Issue baru di repo mana pun dengan label `ai-task` atau awalan judul `[AI]`.
2. Tuliskan deskripsi task secara jelas.
3. Bot akan otomatis:
   - Membalas konfirmasi di Issue.
   - Membuat branch baru `ai/issue-...`.
   - Mengubah/membuat file yang diperlukan.
   - Menerbitkan Pull Request baru.

### Cara B: Melalui Komentar di Issue
Komentari issue yang sudah ada dengan format:
```text
@rafiharefa-bot develop Tolong buatkan unit test untuk auth service dan perbaiki error handling di repository layer.
```
