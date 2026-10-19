import type { CatalogState, Offer } from "./types";
import { offerAvailability, today } from "./domain.ts";

export type SupplyFilter =
  | "all"
  | "available"
  | "pending"
  | "expiring"
  | "expired"
  | "paused"
  | "attention";

export function supplyHealth(
  state: Pick<CatalogState, "merchants" | "skus" | "deliveryPoints">,
  offer: Offer,
  now = new Date(),
) {
  const reason = offerAvailability(state, offer, now);
  const daysLeft = Math.round(
    (Date.parse(offer.validUntil) - Date.parse(today(now))) / 86400000,
  );
  const expired = offer.status === "active" && daysLeft < 0;
  const available = reason === "可参与匹配";
  const expiring = available && daysLeft >= 0 && daysLeft <= 3;
  return { reason, daysLeft, available, expired, expiring };
}

export function matchesSupplyFilter(
  state: Pick<CatalogState, "merchants" | "skus" | "deliveryPoints">,
  offer: Offer,
  filter: SupplyFilter,
  now = new Date(),
) {
  const health = supplyHealth(state, offer, now);
  if (filter === "all") return true;
  if (filter === "available") return health.available;
  if (filter === "pending") return offer.status === "pending";
  if (filter === "paused") return offer.status === "paused";
  if (filter === "expiring") return health.expiring;
  if (filter === "expired") return health.expired;
  return offer.status !== "paused" && (!health.available || health.expiring);
}
