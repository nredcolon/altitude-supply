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
  categoryTemplateId?: string;
  attributes?: Record<string, string>;
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
  deliveryPointId?: string;
  quantityBasis?: "free-supply-v1";
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
  members?: OperationsMember[];
  accessInvitations?: AccessInvitation[];
  categoryTemplates?: CategoryTemplate[];
  deliveryPoints?: DeliveryPoint[];
}

// Definitions are immutable after creation. Disable and create a new definition to revise it.
export interface CategoryTemplate {
  id: string;
  name: string;
  attributes: string[];
  active: boolean;
}
export interface DeliveryPoint {
  id: string;
  name: string;
  address: string;
  active: boolean;
}

export interface OperationsMember {
  id: string;
  userId: string;
  name: string;
  contact: string;
  status: "active" | "disabled";
  joinedAt: string;
}
export interface AccessInvitation {
  id: string;
  tokenHash: string;
  kind: "claim" | "operations";
  merchantId: string | null;
  label: string;
  status: "issued" | "requested" | "accepted" | "revoked";
  expiresAt: string;
  createdAt: string;
  requestedBy: string | null;
  applicantName: string;
  applicantContact: string;
  reviewNote: string;
}
export type InvitationView = Omit<
  AccessInvitation,
  "tokenHash" | "requestedBy"
>;
export interface AccessInvitationPreview {
  workspaceId: string;
  workspaceName: string;
  label: string;
  kind: AccessInvitation["kind"];
  status: AccessInvitation["status"];
  expiresAt: string;
}
export type Access =
  | { role: "operations"; merchantId: null; isOwner: boolean }
  | { role: "merchant"; merchantId: string };
export type CatalogView = Omit<
  CatalogState,
  "ownerId" | "members" | "accessInvitations"
> & {
  access: Access;
  members: Omit<OperationsMember, "userId">[];
  accessInvitations: InvitationView[];
};
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
  accessInvitationCode?: string;
  accessInvitationExpiresAt?: string;
  accessInvitationLabel?: string;
  accessInvitationKind?: "claim" | "operations";
  error?: string;
}
