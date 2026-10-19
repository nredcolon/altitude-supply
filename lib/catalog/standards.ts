import type { CatalogState, DeliveryPoint, Offer } from "./types";

export const QUANTITY_BASIS = "free-supply-v1" as const;
export const QUANTITY_EXPLANATION =
  "填写在所报交期内能按当前条件提供、且未被山海供订单占用的数量。其他渠道售出后请及时更新；这不是实时库存，也不代表实物已锁定。";

export const deliveryLabel = (point: DeliveryPoint) =>
  `${point.name} · ${point.address}`;

export function deliveryIssue(
  state: Pick<CatalogState, "deliveryPoints">,
  offer: Pick<Offer, "deliveryPointId">,
): string | null {
  const points = state.deliveryPoints || [];
  if (!points.length && !offer.deliveryPointId) return null;
  if (!offer.deliveryPointId) return "交货点待标准化，请编辑供货";
  if (!points.some((p) => p.id === offer.deliveryPointId && p.active))
    return "交货点已停用，请编辑供货";
  return null;
}
