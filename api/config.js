export default function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    googleApiKey: process.env.GOOGLE_API_KEY || "",
    googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_API_KEY)
  });
}
