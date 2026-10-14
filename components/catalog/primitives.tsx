"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X, Package } from "lucide-react";

export function Field({
  label,
  children,
  wide = false,
  hint,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  hint?: string;
}) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Status({ value }: { value: string }) {
  const names: Record<string, string> = {
    pending: "待审核",
    active: "已通过",
    suspended: "已暂停",
    rejected: "需修改",
    paused: "已下架",
  };
  return <span className={`status ${value}`}>{names[value] || value}</span>;
}
export function ProductImage({ url, name }: { url: string; name: string }) {
  return (
    <div className="product-image">
      {url ? (
        <img src={url} alt={name} loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <>
          <Package size={42} strokeWidth={1.1} />
          <span>待补商品图片</span>
        </>
      )}
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current!;
    root.querySelector<HTMLElement>("button,input,select,textarea")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const all = [
          ...root.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
          ),
        ];
        if (e.shiftKey && document.activeElement === all[0]) {
          e.preventDefault();
          all.at(-1)?.focus();
        }
        if (!e.shiftKey && document.activeElement === all.at(-1)) {
          e.preventDefault();
          all[0]?.focus();
        }
      }
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [close]);
  return (
    <div className="overlay">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <header>
          <div>
            <small>山海供 · SHANHAI SUPPLY</small>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={close} aria-label="关闭">
            <X />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export const currency = (cents: number) =>
  new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(
    cents / 100,
  );
export const dateAfter = (days: number) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
    new Date(Date.now() + days * 86400000),
  );
