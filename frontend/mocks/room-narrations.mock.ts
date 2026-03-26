/**
 * Room Narrations Mock — Warm Siya Intro Templates
 *
 * Generates warm, conversational intro speeches for the room-select page.
 * These are deterministic (based on room index) so the same room always
 * gets the same phrasing. Swap this file to change Siya's personality.
 */

import type { RoomDTO } from '../services/room.service';

type IntroPosition = 'first' | 'middle' | 'last' | 'only';

/* ───────── Opening lines ───────── */

const OPENINGS: Record<IntroPosition, string[]> = {
  first: [
    "Let me walk you through our rooms! First up is {name}",
    "Alright, let me show you what we've got. Starting with {name}",
    "Let's take a look! Here's {name}",
  ],
  middle: [
    "Moving on — here's {name}",
    "Next up, we have {name}",
    "And here's another lovely option — {name}",
  ],
  last: [
    "And lastly, let me show you {name}",
    "And finally, there's {name}",
    "Last but not least — {name}",
  ],
  only: [
    "Let me tell you about {name}",
    "Here's what we have for you — {name}",
  ],
};

/* ───────── Price lines ───────── */

const PRICE_LINES = [
  ", starting at {price} a night.",
  ", available from {price} per night.",
  ", priced at {price} per night.",
];

/* ───────── Capacity lines ───────── */

const CAPACITY_LINES = [
  " It's perfect for {adults} guest{s}",
  " Comfortably fits {adults} guest{s}",
  " Ideal for {adults} guest{s}",
];

const CHILDREN_LINES = [
  " with room for {children} little one{cs}",
  " and accommodates {children} child{cren} as well",
];

/* ───────── Feature storytelling ───────── */

const FEATURE_STORIES: Record<string, string> = {
  'wi-fi':           'Wi‑Fi to stay connected',
  'wifi':            'Wi‑Fi to stay connected',
  'ac':              'air conditioning for comfort',
  'air conditioning':'air conditioning for comfort',
  'tv':              'a TV for entertainment',
  'television':      'a TV for entertainment',
  'balcony':         'a private balcony to unwind',
  'bathtub':         'a relaxing bathtub',
  'ocean view':      'beautiful ocean views',
  'garden view':     'lovely garden views',
  'king bed':        'a spacious king bed',
  'queen bed':       'a comfortable queen bed',
  'lounge access':   'exclusive lounge access',
  'high floor':      'a high floor for great views',
  'minibar':         'a stocked minibar',
  'room service':    'convenient room service',
  'fireplace':       'a cozy fireplace',
  'pool access':     'pool access to cool off',
  'spa access':      'spa access for relaxation',
  'breakfast':       'complimentary breakfast',
};

/* ───────── Helpers ───────── */

function pick<T>(array: T[], index: number): T {
  return array[index % array.length];
}

function getPosition(index: number, total: number): IntroPosition {
  if (total === 1) return 'only';
  if (index === 0) return 'first';
  if (index === total - 1) return 'last';
  return 'middle';
}

function formatPrice(room: RoomDTO): string {
  const currency = String(room.currency || 'INR').toUpperCase();
  const numericPrice = Number(room.price || 0);
  const amount = Number.isFinite(numericPrice)
    ? numericPrice.toLocaleString('en-IN')
    : String(room.price || '');
  return currency === 'INR' ? `INR ${amount}` : `${currency} ${amount}`;
}

function storyifyFeatures(features: string[], maxCount: number): string {
  const stories: string[] = [];
  for (const feature of features) {
    if (stories.length >= maxCount) break;
    const key = feature.trim().toLowerCase();
    const story = FEATURE_STORIES[key];
    if (story) {
      stories.push(story);
    } else if (feature.trim()) {
      stories.push(feature.trim());
    }
  }
  return stories.length === 0
    ? ''
    : stories.length === 1
      ? stories[0]
      : stories.length === 2
        ? `${stories[0]} and ${stories[1]}`
        : `${stories.slice(0, -1).join(', ')}, and ${stories[stories.length - 1]}`;
}

/* ───────── Main Builder ───────── */

/**
 * Build a warm, conversational Siya narration for a room intro.
 *
 * @param room    The room DTO (from API or mock)
 * @param index   Zero-based position in the intro sequence
 * @param total   Total number of rooms being introduced
 */
export function buildSiyaIntro(room: RoomDTO, index: number, total: number): string {
  const position = getPosition(index, total);
  const parts: string[] = [];

  // Opening
  const opening = pick(OPENINGS[position], index).replace('{name}', room.name || 'this room');
  parts.push(opening);

  // Price
  const priceLine = pick(PRICE_LINES, index)
    .replace('{price}', formatPrice(room));
  parts.push(priceLine);

  // Capacity
  const maxAdults = (room as any).maxAdults;
  if (typeof maxAdults === 'number' && maxAdults > 0) {
    const capLine = pick(CAPACITY_LINES, index)
      .replace('{adults}', String(maxAdults))
      .replace('{s}', maxAdults === 1 ? '' : 's');
    parts.push(capLine);

    const maxChildren = (room as any).maxChildren;
    if (typeof maxChildren === 'number' && maxChildren > 0) {
      const childLine = pick(CHILDREN_LINES, index)
        .replace('{children}', String(maxChildren))
        .replace('{cs}', maxChildren === 1 ? '' : 's')
        .replace('{cren}', maxChildren === 1 ? '' : 'ren');
      parts.push(childLine);
    }
    parts.push('.');
  }

  // Features
  const features = Array.isArray(room.features) ? room.features.filter(Boolean) : [];
  if (features.length > 0) {
    const featureStory = storyifyFeatures(features, 3);
    if (featureStory) {
      parts.push(` You'll find ${featureStory}.`);
    }
  }

  // Clean up
  return parts
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/\.\./g, '.')
    .replace(/ ,/g, ',')
    .trim();
}
