import { BadRequestException } from '@nestjs/common';
import { SETTING_KEYS } from '../../../platform/settings/runtime-settings';
// Leaf files, not the module barrels: Ordering and Sourcing import Operations, so pulling their barrels in here would create a load-time cycle.
import { DEFAULT_DELIVERY_FEE_POLICY, loadDeliveryFeePolicy } from '../../ordering/services/delivery-fee';
import { SUPPORTED_GOVERNORATES } from '../../ordering/services/service-area';
import { decisionWindowHours } from '../../ordering/services/decision-window';
import { getSourcingMode } from '../../sourcing/config/procurement-batch.config';

/**
 * The typed registry of operational settings an Admin may change. Anything not listed here cannot be written, and every value is
 * validated here before it is stored. Secrets (API keys, tokens, database URLs) are deliberately absent: they stay in the deployment.
 */
export type SettingGroup = 'commerce' | 'operations' | 'business';
export type SettingKind = 'boolean' | 'number' | 'integer' | 'enum' | 'text' | 'phone' | 'url' | 'areas' | 'deliveryPolicy';

export interface SettingDefinition {
  key: string;
  group: SettingGroup;
  kind: SettingKind;
  /** Allowed values for `enum` and `areas`. */
  options?: readonly string[];
  min?: number;
  max?: number;
  /** A nullable setting can be cleared (stored as null) to mean "not set". */
  nullable?: boolean;
  /** Deployment default used when no Admin override is stored. */
  fallback: () => unknown;
  /** Returns the normalised value, or throws BadRequestException with the reason. */
  parse: (input: unknown) => unknown;
}

const invalid = (key: string, reason: string): never => {
  throw new BadRequestException({ code: 'INVALID_SETTING', key, message: `${key}: ${reason}` });
};

const bool = (key: string) => (input: unknown): boolean =>
  typeof input === 'boolean' ? input : invalid(key, 'must be true or false');

const money = (key: string, max = 100000) => (input: unknown): number | null => {
  if (input === null) return null;
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 0 || input > max || Math.round(input * 100) !== input * 100) {
    return invalid(key, `must be an amount between 0 and ${max} with at most two decimals, or empty`);
  }
  return input;
};

const text = (key: string, pattern: RegExp, hint: string) => (input: unknown): string | null => {
  if (input === null || (typeof input === 'string' && input.trim() === '')) return null;
  if (typeof input !== 'string') return invalid(key, 'must be text');
  const value = input.trim();
  return pattern.test(value) ? value : invalid(key, hint);
};

const PHONE = /^\+?[0-9][0-9\s-]{6,18}[0-9]$/;
const FACEBOOK = /^https:\/\/(www\.|m\.)?(facebook\.com|fb\.com)\/[A-Za-z0-9._\-/?=&%]+$/;

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: SETTING_KEYS.codEnabled, group: 'commerce', kind: 'boolean', fallback: () => true, parse: bool(SETTING_KEYS.codEnabled),
  },
  {
    key: SETTING_KEYS.deliveryPolicy, group: 'commerce', kind: 'deliveryPolicy',
    fallback: () => {
      try { return loadDeliveryFeePolicy(process.env.DELIVERY_FEE_POLICY ?? ''); } catch { return DEFAULT_DELIVERY_FEE_POLICY; }
    },
    // The same validator checkout uses: a policy that would refuse to quote can never be saved.
    parse: input => {
      if (input === null || typeof input !== 'object') return invalid(SETTING_KEYS.deliveryPolicy, 'must be a delivery policy');
      try {
        return loadDeliveryFeePolicy(JSON.stringify(input));
      } catch {
        return invalid(SETTING_KEYS.deliveryPolicy, 'distance bands must be ascending with a final open band, fees must be valid amounts and the free-shipping threshold above zero');
      }
    },
  },
  {
    key: SETTING_KEYS.deliveryAreas, group: 'commerce', kind: 'areas', options: SUPPORTED_GOVERNORATES, fallback: () => [...SUPPORTED_GOVERNORATES],
    parse: input => {
      if (!Array.isArray(input) || !input.length || input.some(value => !SUPPORTED_GOVERNORATES.includes(value))) {
        return invalid(SETTING_KEYS.deliveryAreas, `choose at least one of ${SUPPORTED_GOVERNORATES.join(', ')}`);
      }
      return SUPPORTED_GOVERNORATES.filter((area: string) => input.includes(area));
    },
  },
  { key: SETTING_KEYS.deliveryInternalCost, group: 'commerce', kind: 'number', nullable: true, min: 0, max: 1000, fallback: () => null, parse: money(SETTING_KEYS.deliveryInternalCost, 1000) },
  { key: SETTING_KEYS.cartonCost, group: 'commerce', kind: 'number', nullable: true, min: 0, max: 1000, fallback: () => null, parse: money(SETTING_KEYS.cartonCost, 1000) },
  { key: SETTING_KEYS.labelCost, group: 'commerce', kind: 'number', nullable: true, min: 0, max: 1000, fallback: () => null, parse: money(SETTING_KEYS.labelCost, 1000) },
  {
    key: SETTING_KEYS.sourcingMode, group: 'operations', kind: 'enum', options: ['INTERNAL_BUY_LIST', 'BROADCAST_ON_DEMAND', 'OFFER_BASED'],
    // A copy of the environment so the saved override is not consulted: this is the deployment default.
    fallback: () => { try { return getSourcingMode({ ...process.env }); } catch { return 'OFFER_BASED'; } },
    parse: input => (input === 'INTERNAL_BUY_LIST' || input === 'BROADCAST_ON_DEMAND' || input === 'OFFER_BASED') ? input : invalid(SETTING_KEYS.sourcingMode, 'use INTERNAL_BUY_LIST, BROADCAST_ON_DEMAND or OFFER_BASED'),
  },
  {
    key: SETTING_KEYS.decisionWindowHours, group: 'operations', kind: 'integer', min: 1, max: 72, fallback: () => decisionWindowHours(process.env.DECISION_WINDOW_HOURS ?? ''),
    parse: input => (typeof input === 'number' && Number.isInteger(input) && input >= 1 && input <= 72) ? input : invalid(SETTING_KEYS.decisionWindowHours, 'must be a whole number of hours between 1 and 72'),
  },
  { key: SETTING_KEYS.checkoutEnabled, group: 'business', kind: 'boolean', fallback: () => true, parse: bool(SETTING_KEYS.checkoutEnabled) },
  { key: SETTING_KEYS.businessPhone, group: 'business', kind: 'phone', nullable: true, fallback: () => null, parse: text(SETTING_KEYS.businessPhone, PHONE, 'must be a phone number') },
  { key: SETTING_KEYS.whatsappNumber, group: 'business', kind: 'phone', nullable: true, fallback: () => null, parse: text(SETTING_KEYS.whatsappNumber, PHONE, 'must be a phone number') },
  { key: SETTING_KEYS.whatsappEnabled, group: 'business', kind: 'boolean', fallback: () => false, parse: bool(SETTING_KEYS.whatsappEnabled) },
  { key: SETTING_KEYS.facebookUrl, group: 'business', kind: 'url', nullable: true, fallback: () => null, parse: text(SETTING_KEYS.facebookUrl, FACEBOOK, 'must be an https Facebook page link') },
  { key: SETTING_KEYS.facebookEnabled, group: 'business', kind: 'boolean', fallback: () => false, parse: bool(SETTING_KEYS.facebookEnabled) },
];

export const SETTING_BY_KEY = new Map(SETTING_DEFINITIONS.map(definition => [definition.key, definition]));
