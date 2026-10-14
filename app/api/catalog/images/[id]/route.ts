import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { catalogImages } from "../../../../../lib/catalog/images";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getChatGPTUser();
  if (!env.DB)
    return Response.json({ error: "数据库尚未准备好" }, { status: 503 });
  return catalogImages(env.DB, env.BUCKET).handle(
    request,
    user?.userId || null,
    (await context.params).id,
  );
}
