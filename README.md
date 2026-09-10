# ⚡ PROMPTX — AI Image Recreation Competition Platform

PROMPTX is a real-time web application built for hosting **AI Image Recreation Competitions**. 

Participants receive a reference image, craft AI image generation prompts, upload their recreated images, and submit their final entries. Organisers manage the competition through a password-protected portal with real-time status monitoring, zoomable image inspection, a /100 scoring matrix, and a 3-round qualification system.

---

## 📁 Architecture & Clean File Structure

```
PROMPTX/
├── index.html            # Main HTML5 UI view (Participant Arena, Organiser Portal, Leaderboard)
├── css/
│   └── styles.css        # Cyber aesthetic design with neon glows, dropzones, and responsive layout
├── js/
│   ├── app.js            # Main application engine (3-round progression, status, scoring matrix)
│   └── supabase.js       # Supabase client integration & local storage sync fallback
├── supabase_schema.sql   # Complete PostgreSQL DB schema & Row Level Security (RLS) policies
└── README.md             # Complete documentation and setup guide
```

---

## 🎨 Competition Format: AI Image Recreation

1. **Reference Image Display**: Admin sets and reveals a high-resolution reference image for the active round.
2. **Prompt Creation**: Participants enter the exact text prompt used in their AI generator (Midjourney, DALL-E, Stable Diffusion, FLUX, etc.) with real-time word and character counters.
3. **Recreated Image Upload**: Participants upload their generated image via drag-and-drop or file picker (JPG/PNG/WEBP up to 10MB) with immediate visual preview.
4. **Final Submission Lock**: Submissions lock after confirmation to prevent further edits during judging.

---

## 🏆 3-Round Qualification System

- **Round 1 (All Teams)**: All registered teams participate $\rightarrow$ Admin selects **Top 7 Qualified Teams**.
- **Round 2 (Top 7 Teams)**: Top 7 teams compete with a new reference image $\rightarrow$ Admin selects **Top 5 Finalists**.
- **Final Round (Top 5 Finalists)**: Top 5 finalists compete $\rightarrow$ Top 3 Winners awarded on the official leaderboard.

*Note: Teams that do not qualify are restricted from submitting in subsequent rounds and are notified to watch the live leaderboard.*

---

## 🔐 Organiser Command Portal

- **Password Authentication**: Default password is `promptxadmin`.
- **Live Status Metrics**: Real-time counter of 🟢 **WORKING LIVE**, 🟡 **IDLE**, and 🔵 **SUBMITTED TEAMS**.
- **Reference Image Manager**: Update reference images via direct URL or local file upload.
- **Image Inspector & Downloader**: View side-by-side comparisons of the original reference image vs. the participant's AI recreated image with one-click download.
- **Scoring Matrix (/100 Points)**:
  - **Prompt Quality**: /25
  - **Image Similarity**: /40
  - **Creativity**: /20
  - **Overall Accuracy**: /15
- **Leaderboard Control**: Toggle **REVEAL LEADERBOARD** to display official rankings to participants when judging is complete.

---

## ⚡ Setup & Database Options

### Option A: Zero-Config Local Test Mode (Default)
No setup required! Simply open `index.html` in any modern web browser or host via any local HTTP server. LocalStorage and cross-tab event sync enable multi-window testing.

### Option B: Supabase Cloud Setup (Real-Time & Storage)
1. Create a project at [supabase.com](https://supabase.com).
2. Go to the **SQL Editor** in Supabase and execute the contents of `supabase_schema.sql`.
3. Create two public storage buckets named `recreated-images` and `reference-images`.
4. Update `js/supabase.js` with your Supabase URL and Anon Key:
   ```javascript
   const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
   const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
   ```

---

## 🧪 Quick Test / Demo Mode

1. Click the discrete lock icon 🔒 in the top-right navbar.
2. Enter password `promptxadmin` to open the Organiser Console.
3. Click **Load Demo Submissions** to generate sample team entries with prompts and recreated images for instant scoring matrix evaluation.
