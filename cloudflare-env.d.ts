declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    SHANHAI_WORKSPACE_ID?: string;
  }
}
