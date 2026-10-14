"use client";

import { useState } from "react";
import { ImagePlus, LoaderCircle } from "lucide-react";
import { ProductImage } from "./primitives";

export function ImageField({
  workspaceId,
  initialUrl = "",
  onBusy,
}: {
  workspaceId: string;
  initialUrl?: string;
  onBusy: (busy: boolean) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="field wide image-field">
      <span>商品图片</span>
      <input type="hidden" name="imageUrl" value={url} />
      <div className="upload-row">
        <ProductImage url={url} name="商品图片预览" />
        <div>
          <label className={`btn ${busy ? "disabled" : ""}`}>
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <ImagePlus size={17} />
            )}
            {busy ? "正在上传…" : "选择商品图片"}
            <input
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              aria-label="选择商品图片"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setError("");
                if (file.size > 5 * 1024 * 1024) {
                  setError("图片不能超过 5 MB");
                  return;
                }
                setBusy(true);
                onBusy(true);
                try {
                  const response = await fetch(
                    `/api/catalog/images?workspaceId=${encodeURIComponent(workspaceId)}`,
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": file.type || "application/octet-stream",
                      },
                      body: file,
                    },
                  );
                  const data = (await response.json()) as {
                    imageUrl?: string;
                    error?: string;
                  };
                  if (!response.ok || !data.imageUrl)
                    throw new Error(data.error || "上传失败");
                  setUrl(data.imageUrl);
                } catch (error) {
                  setError((error as Error).message);
                } finally {
                  setBusy(false);
                  onBusy(false);
                }
              }}
            />
          </label>
          <small>JPG、PNG 或 WebP，最大 5 MB。</small>
          {url && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setUrl("")}
            >
              移除图片
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <details>
        <summary>使用已有图片链接</summary>
        <input
          type="url"
          aria-label="已有图片链接"
          disabled={busy}
          placeholder="https://…"
          maxLength={2000}
          value={url.startsWith("/") ? "" : url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </details>
    </div>
  );
}
