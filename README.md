# upMe — Instant Cross-Platform Share (Text, Links & Files)

> A secure, lightweight, cross-platform Progressive Web Application (PWA) for single-user cross-device file & text sharing (Windows, Android, iPadOS) without user logins.

---

## 🏗️ Decoupled Architecture

- **Frontend SPA**: Vanilla JavaScript + Vite + CSS Glassmorphism design system, hosted on **Netlify**.
- **Backend & Storage**: **Supabase** (PostgreSQL, Row Level Security, Storage Buckets, and `pg_cron` auto-cleanup).

---

## 🛠️ Step-by-Step Setup Guide

### STEP 1: Supabase Backend Setup

1. **Create a Supabase Project**:
   - Go to [supabase.com](https://supabase.com) and create a free tier project.
   - Copy your **Project URL** and **`anon` (public) API Key** from **Project Settings -> API**.

2. **Execute SQL Setup Script**:
   - Open your Supabase Dashboard -> **SQL Editor**.
   - Copy and paste the entire contents of [`supabase_setup.sql`](file:///c:/Users/bhupa/.gemini/antigravity/scratch/upMe/supabase_setup.sql).
   - Click **Run**.
   - This automatically creates:
     - The `shares` database table with UUID primary key, passcode column, expiration timestamps, and indexes.
     - Row Level Security (RLS) policies allowing anonymous access with valid passcodes.
     - The `user-shares` public storage bucket with a 50MB file size limit.
     - The `pg_cron` background job running every 5 minutes to delete expired shares.
     - A Database Trigger (`trigger_delete_share_storage`) that automatically purges files from storage when database records are deleted.

---

### STEP 2: Local Project Setup & Development

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Configuration** (Optional):
   Create a `.env` file in the root directory:
   ```env
   VITE_SUPABASE_URL=https://your-supabase-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-actual-anon-key-here
   ```
   *(Note: You can also configure credentials directly inside the web app UI by clicking the ⚙️ Settings icon in the header).*

3. **Start Development Server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

---

### STEP 3: Deploying to Netlify

#### Option A: Netlify Dashboard (Git Integration)
1. Push this project codebase to a GitHub / GitLab repository.
2. Log in to [Netlify](https://netlify.com) -> **Add new site** -> **Import an existing project**.
3. Configure build settings:
   - **Build Command**: `npm run build`
   - **Publish Directory**: `dist`
4. Add Environment Variables under **Site Configuration -> Environment Variables**:
   - Key: `VITE_SUPABASE_URL`, Value: `https://your-supabase-project.supabase.co`
   - Key: `VITE_SUPABASE_ANON_KEY`, Value: `your-anon-key`
5. Click **Deploy Site**.

#### Option B: Netlify CLI
```bash
npm run build
npx netlify-cli deploy --prod --dir=dist
```

---

## 📱 Features & Device Verification

### 1. Sender Flow
- Paste text/links or drag and drop files up to 50MB.
- Choose expiration duration: 1 Hour, 8 Hours, 24 Hours, or 7 Days.
- Toggle **One-Time Download** to auto-destruct immediately after retrieval.
- Generates a 6-digit numeric passcode and an auto-embedded QR Code (`https://your-app.netlify.app/?code=123456`).

### 2. Receiver Flow (Windows, Android, iPadOS)
- Enter 6-digit passcode or scan QR code.
- Query automatically validates `code = :input_code AND expires_at > now()`.
- One-click **Copy Text to Clipboard** or **Download File**.

### 3. PWA Native Experience
- Click **Install** in the app header (or **Add to Home Screen** on iOS/iPadOS Safari & Android Chrome).
- Works as a standalone, distraction-free app across all platforms.
