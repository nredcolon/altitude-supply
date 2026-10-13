import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { catalogService } from "../../../lib/catalog/service";

async function handle(request: Request) {
  const user = await getChatGPTUser();
  if (!env.DB)
    return Response.json(
      { error: "数据库尚未准备好，请先运行迁移" },
      { status: 503 },
    );
  return catalogService(env.DB).handle(request, user?.userId || null);
}
export const GET = handle;
export const POST = handle;
