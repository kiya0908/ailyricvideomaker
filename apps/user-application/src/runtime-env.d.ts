// Wrangler 4.56.0 cannot declare required secret names in wrangler.jsonc.
// Keep names typed here while values remain managed by Cloudflare secrets.
declare namespace Cloudflare {
  interface Env {
    BETTER_AUTH_SECRET: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    POLAR_SECRET: string;
  }
}
