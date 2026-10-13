export type ReviewStatus = "pending" | "active" | "suspended";

export interface Merchant {
  id: string;
  userId: string | null;
  name: string;
  contact: string;
  location: string;
  categories: string;
  status: ReviewStatus;
  reviewNote: string;
  createdAt: string;
}

// SKU identity contains no supplier-specific price, stock or lead time.
export interface Sku {
  id: string;
  code: string;
  name: string;
  category: string;
  origin: string;
  model: string;
  material: string;
  specification: string;
  quality: string;
  unit: string;
  packaging: string;
  imageUrl: string;
  fingerprint: string;
  status: "pending" | "active" | "rejected";
  submittedBy: string;
  reviewNote: string;
  createdAt: string;
}

export interface Offer {
  id: string;
  skuId: string;
  merchantId: string;
  merchantCode: string;
  unitPrice: number; // Integer CNY cents; price basis is shared by the workspace.
  availableQuantity: number;
  minimumQuantity: number;
  quantityStep: number;
  leadDays: number;
  deliveryLocation: string;
  validUntil: string;
  status: "pending" | "active" | "paused" | "rejected";
  version: number;
  reviewNote: string;
  updatedAt: string;
}

export interface CatalogEvent {
  id: string;
  actorId: string;
  merchantId: string | null;
  action: string;
  targetId: string;
  detail: string;
  at: string;
}

export interface CatalogState {
  schemaVersion: 1;
  ownerId: string;
  priceBasis: string;
  merchants: Merchant[];
  skus: Sku[];
  offers: Offer[];
  events: CatalogEvent[];
}

export type Access =
  | { role: "operations"; merchantId: null }
  | { role: "merchant"; merchantId: string };
export type CatalogView = Omit<CatalogState, "ownerId"> & { access: Access };
export interface WorkspaceSummary {
  id: string;
  name: string;
  role: Access["role"];
}
export interface CatalogResponse {
  workspaces: WorkspaceSummary[];
  workspace?: { id: string; name: string; revision: number; data: CatalogView };
  invitationCode?: string;
  invitationExpiresAt?: string;
  error?: string;
}
