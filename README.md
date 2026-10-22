# D&D 5e Character Creator

A free, clean, browser-only D&D 5e character creator. Single HTML file, no build step, no back-end. Hosted on GitHub Pages.

**Live:** https://jordanbdcarroll.github.io/dnd-character-creator/

---

## Tech

| Concern | Approach |
|---|---|
| Data source | [dnd5eapi.co](https://www.dnd5eapi.co) — free, no auth, SRD content |
| API base URL | `https://www.dnd5eapi.co/api/2014/` |
| Persistence | `localStorage` for characters + API response cache |
| Build | Zero — single `index.html` |
| Fonts | Cinzel (headings) + Inter (body) via Google Fonts |

---

## API Endpoints Used

```
GET /api/2014/races                          — list of 9 SRD races
GET /api/2014/races/{index}                  — race detail (ASIs, traits, languages, subraces)
GET /api/2014/subraces/{index}               — subrace detail (extra ASIs, traits)
GET /api/2014/traits/{index}                 — trait description text (fetched lazily on expand)
GET /api/2014/classes                        — list of 12 SRD classes
GET /api/2014/classes/{index}                — class detail (hit die, proficiencies, spellcasting)
GET /api/2014/backgrounds                    — list of SRD backgrounds
GET /api/2014/backgrounds/{index}            — background detail (skills, languages, equipment, feature)
GET /api/2014/classes/{index}/levels         — all 20 levels: features, spell slots, ASIs, class resources
GET /api/2014/classes/{index}/spells         — class spell list (filter by level 0 / 1)
GET /api/2014/spells/{index}                 — spell description (lazy)
GET /api/2014/subclasses/{index}             — subclass detail
GET /api/2014/subclasses/{index}/levels      — subclass features by level
GET /api/2014/features/{index}               — feature description (lazy)
GET /api/2014/feats                          — feat list
GET /api/2014/features/fighter-fighting-style — fighting style options
GET /api/2014/skills                         — full skill list with governing ability scores
GET /api/2014/languages                      — language list
GET /api/2014/equipment-categories/all-armor — armor list for AC calculation
```

All responses are cached in `localStorage` under `dnd5e-api-cache` after the first fetch.

---

## Character Data Model

```js
{
  id:        String,   // crypto.randomUUID()
  createdAt: Number,   // Date.now()
  updatedAt: Number,
  step:      String,   // current creation step: 'race'|'class'|'abilities'|'background'|'choices'|'skills'|'equipment'|'details'|'complete'
  portrait:  String|null,  // base64 data URL or null

  // Core choices
  race: {
    index, name, speed, size,
    ability_bonuses,        // [{ ability_score: {index, name}, bonus }]
    traits,                 // [{ index, name }]  — descriptions fetched lazily
    languages,              // [{ index, name }]
    language_options,       // { choose: N } or null
    starting_proficiencies, // [{ index, name }]
    subraces,               // [{ index, name }]
  } | null,

  subrace: {
    index, name,
    ability_bonuses,  // extra ASIs on top of race
    racial_traits,    // [{ index, name }]
  } | null,

  klass: {             // 'class' is a reserved word in JS
    index, name, hit_die,
    saving_throws,           // [{ index }]
    proficiencies,           // weapons, armor, tools
    proficiency_choices,     // skill pick options
    spellcasting,            // { ability, spell_slots_per_level } or null
    starting_equipment,      // []
    starting_equipment_options, // []
  } | null,

  background: {
    index, name,
    skill_proficiencies,
    language_options,
    starting_equipment,
    feature,
    personality_traits, ideals, bonds, flaws,  // option arrays
  } | null,

  abilityMethod: 'standard' | 'pointbuy' | 'roll' | null,
  baseScores: { str, dex, con, int, wis, cha },  // before racial ASIs

  skillProficiencies: [String],  // skill indices
  bonusLanguages:     [{ index, name }],  // languages chosen
  cantrips:           [String],  // spell indices
  level1Spells:       [String],
  level:              Number,   // 1–20
  raceAbilityChoices: [String], // Half-elf free +1s
  asi:                { [level]: { mode, a, b, feat } },
  racialProficiencies, toolProficiencies, expertise, dragonAncestry, draconicAncestry,
  racialCantrips, favoredEnemies, favoredTerrains, spells, spellSlots, spellLevels, spellNames,
  appearance, backstory, allies, notes,
  subclassChoice:     { index, name }|null,
  fightingStyle:      { index, name }|null,
  equipment:          [{ index, name, quantity }],
  useGold:            Boolean,
  startGold:          Number,

  // Flavor
  name:              String,
  alignment:         String,
  personalityTraits: [String],   // 2 entries
  ideal:             String,
  bond:              String,
  flaw:              String,
}
```

### Computed values (derived at render time, not stored)

| Value | Formula |
|---|---|
| Ability modifier | `floor((score - 10) / 2)` |
| HP (level 1) | `hit_die_max + CON modifier` |
| AC (no armor) | `10 + DEX modifier` |
| Proficiency bonus | `+2` at level 1 |
| Saving throw | `ability_mod + (proficient ? 2 : 0)` |
| Skill total | `ability_mod + (proficient ? 2 : 0)` |
| Spell save DC | `8 + 2 + casting_ability_mod` |
| Spell attack | `2 + casting_ability_mod` |

---

## Creation Steps

| # | Step | Key Decisions |
|---|---|---|
| 1 | **Race** | Pick race + subrace. Shows ASIs, traits, languages, proficiencies. |
| 2 | **Class** | Pick class. Shows hit die, saves, proficiencies, starting equipment. |
| 3 | **Abilities** | Standard Array / Point Buy (27 pts) / Manual Roll (4d6 drop lowest). Racial ASIs applied live. |
| 4 | **Background** | Skill profs, languages, equipment, personality flavor pool. |
| 5 | **Class Choices** | Cantrips + spells (casters), Fighting Style (Fighter), Divine Domain (Cleric), etc. |
| 6 | **Skills** | Choose from class skill list (correct count per class). |
| 7 | **Equipment** | Starting gear from class + background, or take gold instead. |
| 8 | **Details** | Name, alignment, two personality traits, ideal, bond, flaw, portrait upload. |

---

## Status

### ✅ v0 — complete
- Home page: character list, new character button, delete
- Race selection step: all 9 SRD races, subraces, trait details (lazy-loaded), ASIs, languages, proficiencies
- Save to `localStorage`, character shows on home page with race icon

### ✅ v1 — class selection (untested against live API)
- All 12 SRD classes with hit die, saves, proficiencies, skill choices, starting equipment, spellcasting ability
- Race step now continues into class step; changing class clears class-dependent choices

### ✅ v2 — ability scores
- Standard array, point buy (27 pts), 4d6 roll; racial + subrace bonuses shown live

### ✅ v3 — background selection
- Skills, languages, equipment, feature, and personality pools. dnd5eapi only ships Acolyte, so extra backgrounds are merged in from [Open5e](https://open5e.com) (`api.open5e.com/v1/backgrounds`, optional; untested against the live API)

### ✅ v4 — class choices (level 1)
- Cantrips + spells with counts from `/classes/{x}/levels/1` (prepared casters: ability mod + 1; wizard spellbook 6), subclass for Cleric/Sorcerer/Warlock, Fighter fighting style, lazy spell descriptions
- Not yet covered: Ranger favored enemy, other class-specific level-1 picks

### ✅ v5 — skills + languages
- Class skill picks (disabled when already granted by race/background), bonus languages from race/subrace/background

### ✅ v6 — equipment
- Class + background starting gear incl. nested "pick from category" choices, or roll starting gold instead

### ✅ v7 — details
- Name, alignment, traits/ideal/bond/flaw (with background suggestions), portrait upload (downscaled to ≤320px JPEG)

### ✅ v8 — character sheet
- Derived stats (AC from armor/shield, HP, saves, skills, attacks, spell DC/attack), print stylesheet, jump back to edit any step

### ✅ v9 — JSON export / import
- Export from the sheet, import from the home page (never overwrites an existing character)

### ✅ v10 — rules completeness
- **Levels 1–20:** pick a level on the Class step. Proficiency bonus, HP (max die at 1st, average after, + CON), spell slots, cantrips / spells known or prepared, class features by level, resources (rage, sneak attack, …) all follow the class level table (`/classes/{x}/levels`).
- **Ability Score Improvements** at the class's ASI levels (+2 / +1 +1 / feat, capped at 20); feats come from `/feats` (the SRD only has Grappler).
- **Subclass** chosen at its real level (e.g. Wizard 2, Fighter 3); subclass features listed on the sheet.
- **Race choices:** Half-elf free +1s and skills, Dragonborn ancestry (breath weapon, resistance), High Elf cantrip, Dwarf tool pick.
- **Class choices:** Fighting Style (Fighter 1, Paladin/Ranger 2), Ranger favored enemy/terrain, Rogue/Bard expertise, Bard/Monk instrument/tool picks, Life Domain spells, Draconic Sorcerer ancestry.
- **Sheet:** feature/trait/spell descriptions (loaded on expand; "Print with descriptions" opens them all), spell slots, hit dice, death saves, currency, carry weight vs capacity, armor/weapon/tool proficiencies, unarmed strike, appearance, backstory, allies, notes.
- Characters saved by older versions are migrated automatically on load.

### Known limitations
- No multiclassing; no Mystic Arcanum / Eldritch Knight / Arcane Trickster spellcasting.
- Class options not tracked as choices (Eldritch Invocations, Metamagic, Battle Master maneuvers, Pact Boon, Land druid spells, …). Use the Notes field; the feature text is on the sheet.
- Only SRD content comes from the API (one subclass per class, one cleric domain); extra backgrounds come from Open5e.
- Favored enemy language, Dragonborn/Sorcerer extra languages, and spell-slot / HP tracking during play are not handled (the sheet is a build sheet, not a play tracker).
- Tested against mocked API responses, not the live APIs.

---

## Design

- **Look:** illustrated tabletop — warm parchment with a faint paper grain, iron-gall ink, a single oxblood accent, leather header bar. Flat, book-like panels with double rules and inset frames; no glows or blurs.
- **Icons:** every race, class and background has a hand-drawn line emblem (inline SVG in `index.html`, see `RACE_ICONS` / `CLASS_ICONS` / `BG_ICONS`). No emoji.
- **Fonts:** IM Fell English SC (headings), Alegreya (body), Alegreya Sans (UI labels) via Google Fonts, with Georgia fallbacks.
- **Tokens:** `--paper*`, `--ink*`, `--rule*`, `--blood*`, `--leather*` at the top of the stylesheet; `@media print` swaps them to black on white.
- **Layout:** mobile-first. Wizard step bar always visible. Continue button disabled until the step is fully valid.
