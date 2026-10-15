# Imported FPS art

All imported source assets below are CC0. Original license files are retained.
The purchase prices in the game apply only to in-game cosmetics, not to an asset license.

* Kenney, **Space Station Kit**: https://kenney.nl/assets/space-station-kit
* Kenney, **Blaster Kit**: https://kenney.nl/assets/blaster-kit
* Kenney, **Sci-fi Sounds**: https://kenney.nl/assets/sci-fi-sounds
* Kenney, **Interface Sounds**: https://kenney.nl/assets/interface-sounds
* Kenney, **Particle Pack**: https://kenney.nl/assets/particle-pack
* Quaternius, **Toon Shooter Game Kit**, soldier model and animations:
  https://quaternius.com/packs/toonshootergamekit.html
  The author's Google Drive download was over quota. The original glTF asset was
  retrieved from https://github.com/aar0npal/shooter-blitz/blob/main/public/models/Character_Soldier.gltf
  No application code was copied from that project.

The glTF and selected OBJ/MTL/palette source files are retained under `source/`.
`node scripts/build-fps-assets.cjs` samples palettes, bakes the character's idle
and eight running poses, and rebuilds `models.bin` plus its bounds/SHA-256 manifest.
The original glTF stores additional weapon attachments; the converter selects only
the soldier body, head and shoulder pads. Weapon attachment transforms are retained
so the imported Kenney weapon follows the character's hand in each pose.

Local adapters, the arena layout, skin recolors, interface treatment and Lucky Smile
are project code. Asset loading requires no external host at runtime.
