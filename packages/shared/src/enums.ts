import { z } from 'zod';

export const TENANT_STATUSES = ['onboarding', 'active', 'suspended'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ['invited', 'active', 'inactive'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const ACCOUNT_STATUSES = ['active', 'frozen'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const PHOTO_REVIEWS = ['pending', 'published', 'discarded'] as const;
export type PhotoReview = (typeof PHOTO_REVIEWS)[number];

export const ICON_GROUPS = ['infrastructure', 'environment', 'public_services'] as const;
export type IconGroup = (typeof ICON_GROUPS)[number];

export const COMMERCIAL_STATUSES = [
  'new',
  'contacted',
  'proposal_sent',
  'negotiating',
  'won',
  'lost',
] as const;
export type CommercialStatus = (typeof COMMERCIAL_STATUSES)[number];

export const PHOTO_PURPOSES = ['report', 'contest', 'completion', 'impediment'] as const;
export const photoPurposeSchema = z.enum(PHOTO_PURPOSES);
export type PhotoPurpose = z.infer<typeof photoPurposeSchema>;
