# Fonts for the Text command

All are under the SIL Open Font License 1.1 (the `*-OFL.txt` file beside each). None has a Reserved
Font Name.

- `Outfit-Regular.ttf` (Outfit) and `JetBrainsMono-Regular.ttf` (JetBrains Mono) are modified: their
  overlapping contours were merged (fontTools `removeOverlaps`) so every letter outline is a simple
  closed curve, which a CAD region needs.
- `Lora-Regular.ttf` (Lora) is unmodified.
- `Inter-Regular.ttf`, `Roboto-Regular.ttf`, `SpaceGrotesk-Regular.ttf`, `SpaceMono-Regular.ttf` and
  `Poppins-Regular.ttf` come from the google/fonts repository. They are modified: the variable fonts
  (Inter, Roboto, Space Grotesk) were fixed at their Regular instance (fontTools `instancer`), all
  five were cut down to Latin-1, Latin Extended-A and common punctuation (fontTools `subset`, no
  hinting), and their overlapping contours were merged (`removeOverlaps`).
