export const GAME_VARIANTS = {
  classic_blotto: {
    id: 'classic_blotto',
    label: 'Original',
    description:
      'Allocate 100 soldiers across 10 hills. Hill i is worth i points. Beat opponents in your group.',
  },
} as const

export type GameVariantId = keyof typeof GAME_VARIANTS

export function isGameVariantId(value: unknown): value is GameVariantId {
  return typeof value === 'string' && value in GAME_VARIANTS
}
