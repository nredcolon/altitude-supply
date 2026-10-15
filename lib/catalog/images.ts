import { accessFor, CatalogError, ensure } from "./domain.ts";
import type { CatalogState } from "./types";
import { platformRow, type PlatformOptions } from "./platform.ts";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const reply = (error: string, status: number) =>
  Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );

export function imageType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}

async function limitedBody(request: Request) {
  ensure(request.body, "请选择图片");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new CatalogError("图片不能超过 5 MB", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function catalogImages(
  db: D1Database,
  bucket: R2Bucket | undefined,
  options: PlatformOptions = {},
) {
  return {
    async handle(
      request: Request,
      userId: string | null,
      imageId?: string,
    ): Promise<Response> {
      try {
        ensure(userId, "请先登录", 401);
        ensure(bucket, "图片存储暂未准备好，请联系平台运营", 503);
        const workspaceId =
          new URL(request.url).searchParams.get("workspaceId") || "";
        ensure(/^[a-f0-9-]{36}$/.test(workspaceId), "请选择运营空间");
        const row = await platformRow(db, options);
        ensure(row.id === workspaceId, "不能访问其他平台图片", 403);
        const state: CatalogState = JSON.parse(row.data);
        const access = accessFor(state, userId);
        if (request.method === "POST" && !imageId) {
          const origin = request.headers.get("origin");
          ensure(
            !origin || origin === new URL(request.url).origin,
            "不允许跨站提交",
            403,
          );
          ensure(
            access.role === "operations" ||
              state.merchants.find((m) => m.id === access.merchantId)
                ?.status === "active",
            "请先完成商户准入审核",
            403,
          );
          const bytes = await limitedBody(request);
          const type = imageType(bytes);
          ensure(type, "仅支持 JPG、PNG 或 WebP 图片");
          const id = crypto.randomUUID();
          await bucket.put(`catalog/${workspaceId}/${id}`, bytes, {
            httpMetadata: { contentType: type },
            customMetadata: { uploadedBy: userId },
          });
          return Response.json(
            {
              imageUrl: `/api/catalog/images/${id}?workspaceId=${workspaceId}`,
            },
            { status: 201, headers: { "Cache-Control": "no-store" } },
          );
        }
        ensure(
          request.method === "GET" &&
            imageId &&
            /^[a-f0-9-]{36}$/.test(imageId),
          "图片不存在",
          404,
        );
        const object = await bucket.get(`catalog/${workspaceId}/${imageId}`);
        ensure(object, "图片不存在", 404);
        const url = `/api/catalog/images/${imageId}?workspaceId=${workspaceId}`;
        ensure(
          access.role === "operations" ||
            object.customMetadata?.uploadedBy === userId ||
            state.skus.some(
              (s) =>
                s.imageUrl === url &&
                (s.status === "active" || s.submittedBy === userId),
            ),
          "无权访问该图片",
          403,
        );
        return new Response(object.body, {
          headers: {
            "Content-Type":
              object.httpMetadata?.contentType || "application/octet-stream",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (error) {
        if (error instanceof CatalogError)
          return reply(error.message, error.status);
        return reply("图片处理失败，请稍后重试", 500);
      }
    },
  };
}
