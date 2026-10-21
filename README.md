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
GET /api/2014/classes/{index}/levels/1       — level-1 spellcasting counts
GET /api/2014/classes/{index}/spells         — class spell list (filter by level 0 / 1)
GET /api/2014/spells/{index}                 — spell description (lazy)
GET /api/2014/subclasses/{index}             — subclass detail
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

### Known limitations
- Level 1 characters only
- Half-elf's two free +1 ability scores and Skill Versatility are not handled (API models them as options)
- Ranger favored enemy, tool/instrument proficiency choices, and expertise are not covered
- Everything beyond the happy path was tested against mocked API responses, not the live APIs

---

## Design

- **Theme:** Dark, warm fantasy — not parchment, not neon. Deep navy + gold accents.
- **Colors:** `#0d0d1a` background, `#c9aa71` gold, class-specific accent colors (upcoming).
- **Open5e:** extra backgrounds come from `https://api.open5e.com/v1`; override with `window.OPEN5E_BASE`. If unreachable the app falls back to SRD-only.
- **Fonts:** Cinzel for headings, Inter for body.
- **Layout:** Mobile-first, responsive grid. Wizard step bar always visible.
- **Validation:** Continue button disabled until step is fully valid. Impossible to advance with an invalid character.

---

## Self-hosting

The site is static files only — serve `index.html` from any web server (nginx, Caddy, Apache, etc.); no build step.

- **API:** by default it calls `https://www.dnd5eapi.co/api/2014`. To use your own mirror (e.g. the open-source [5e-srd-api](https://github.com/5e-bits/5e-srd-api) in Docker), set `window.DND_API_BASE = '/api/2014'` in a `<script>` before the main script.
- **Open5e:** extra backgrounds come from `https://api.open5e.com/v1`; override with `window.OPEN5E_BASE`. If unreachable the app falls back to SRD-only.
- **Fonts:** currently loaded from Google Fonts; vendor Cinzel/Inter locally if your server must not call third parties.
- **Data:** characters live in each visitor's browser `localStorage`; the server stores nothing.
