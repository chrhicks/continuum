import { Clock, Effect, Random } from 'effect'

export const currentDate = Clock.currentTimeMillis.pipe(
  Effect.map((millis) => new Date(millis)),
)

export const randomUuid = Effect.fn('Backup.randomUuid')(function* () {
  const first = yield* randomHex(8)
  const second = yield* randomHex(4)
  const third = yield* randomHex(3)
  const variant = yield* Random.nextIntBetween(8, 11)
  const fourth = yield* randomHex(3)
  const fifth = yield* randomHex(12)
  return `${first}-${second}-4${third}-${variant.toString(16)}${fourth}-${fifth}`
})

function randomHex(length: number): Effect.Effect<string> {
  return Effect.forEach(Array.from({ length }), () =>
    Random.nextIntBetween(0, 15),
  ).pipe(
    Effect.map((digits) => digits.map((digit) => digit.toString(16)).join('')),
  )
}
