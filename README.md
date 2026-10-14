<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Shop.CO

## Run locally

Prerequisite: Node.js

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `NEGOTIATION_AI_API_KEY`. `APP_URL` is optional locally.
3. Start the app with `npm run dev`.

## Deploy to Vercel

The app is a Vite single-page application with serverless API routes in `api/`.

1. Push the project to a GitHub repository. Do not commit `.env`, `.env.local`, or any other file containing real credentials; these are ignored by `.gitignore`.
2. In Vercel, select **Add New... > Project**, connect GitHub if prompted, and import the repository.
3. Configure the project root as the folder containing `package.json` and `vercel.json`. Use the Vite framework preset, `npm install` for installation, `npm run build` as the build command, and `dist` as the output directory. The checked-in `vercel.json` already sets the build and output values.
4. In **Environment Variables**, add:
   - `NEGOTIATION_AI_API_KEY` — required; the OpenRouter API key used by the server-side negotiation endpoint. Keep this server-side; do not prefix it with `VITE_`.
   - `APP_URL` — optional; set this to the deployed site URL (for example, `https://your-project.vercel.app`) for OpenRouter request metadata.

   Add the variables to the Production environment and to Preview/Development if those deployments also need AI negotiation. Do not upload a `.env` file to Vercel.
5. Select **Deploy**. After deployment, check `https://your-project.vercel.app/api/health` returns `{"status":"ok"}` and test negotiation in the site.
6. If you change an environment variable later, redeploy for the change to take effect.
7. In Firebase Console, add the Vercel production domain under **Authentication > Settings > Authorized domains** if users sign in. Confirm Firestore is enabled and deploy/review the repository's `firestore.rules`; those Firebase setup steps are separate from Vercel deployment.

Firebase's browser configuration is loaded from `firebase-applet-config.json` and is not a server secret. The current source does not use `GEMINI_API_KEY`, `MONGODB_URI`, or `JWT_SECRET`; do not add them as Vercel variables unless the application code is changed to use them.

Before publishing, revoke and replace any real API key that has been present in a local `.env` file. Enter the replacement only in Vercel's Environment Variables and in your local ignored `.env`.
