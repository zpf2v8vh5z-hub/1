# Liberty Heights — Open-World-Sandbox

Eine spielbare 3D-Open-World-Sandbox im Browser: Straßenraster-Stadt mit
Hochhäusern, Verkehr, Passanten, klautbaren Autos mit Drift-Physik, Schusswaffe,
Wanted-Level und Polizeiverfolgung. Kein Story-Modus.

**Was das ist:** eine Vertical Slice — der technische Kern eines GTA-artigen
Spiels, in einem Turn gebaut. **Was das nicht ist:** GTA 5. Kein Netzwerk, keine
Story, keine Missionen, keine Animation-Rigs, keine Konsolen-Performance.

---

## Starten

```bash
cd openworld
python3 serve.py 8081
# http://localhost:8081
```

**Benutze `serve.py`, nicht `python -m http.server`.** Der eingebaute Server
schickt keine Cache-Header, Browser bedienen sich dann aus dem Cache — bis hin
zum `304`, bei dem eine Code-Änderung die Seite nie erreicht. `serve.py` setzt
`Cache-Control: no-store` und ignoriert bedingte Requests, jede Aktualisierung
kommt also an. Alternativ: einmal hart neu laden (`Strg+Shift+R`).

Die im Menü angezeigte Build-Kennung (`v461031c · 5b5a0e7`) sagt dir, welcher
Code wirklich läuft. Sie wird von `tools/stamp_build.py` in `index.html` und in
alle relativen Modul-Imports geschrieben (Cache-Busting). Nach Änderungen an
`src/` einmal `python3 tools/stamp_build.py` ausführen.

Braucht einen Browser mit WebGL 2 und ES-Modulen (Chrome, Edge, Firefox, Safari 16+).
Kein Build-Schritt, kein npm install — three.js liegt als einzelne Datei in `vendor/`.

## Steuerung

| Taste | Zu Fuß | Im Fahrzeug |
| --- | --- | --- |
| `W A S D` | Laufen | Gas / Bremse / Lenken |
| `Shift` | Sprint | Boost |
| `Leertaste` | Springen | Handbremse (Drift) |
| Maus | Umsehen (Klick ins Bild = Pointer Lock) | Kamera, rastet hinter dem Auto ein |
| Linksklick | Schießen | — |
| Rechtsklick | Zielen (Zoom, Fadenkreuz) | — |
| `F` / `E` | Einsteigen (auch in Verkehrs-Autos) | Aussteigen |
| `R` | Nachladen | — |
| `H` | — | Hupe |
| `M` | Ton stumm | Ton stumm |
| `Esc` | Pause | Pause |
| `T` | Texturen: echte zu Platzhalter umschalten | dito |

### Touchscreen

Auf Geräten mit Touch wird die Steuerung automatisch aktiv (`?touch=1` erzwingt
sie, `?touch=0` schaltet sie ab). Im Start- und Pause-Menü gibt es dafür einen
Schalter, die Wahl wird in `localStorage` gespeichert.

- **Joystick links** — zu Fuß Bewegung, im Auto Lenkung (x) und Gas/Bremse (y),
  mit Deadzone gegen Kriechen
- **Rechts: Feuer, Ein/Aus, Bremse/Handbremse, Nachladen**
- **Wischen auf der rechten Bildschirmhälfte** dreht die Kamera (kein Pointer Lock nötig)

Die Touch-Eingabe schreibt in denselben Eingabezustand wie die Tastatur, es gibt
also keine zweite Spiel-Logik — `test/touch.mjs` prüft Deadzone, Achsen,
Buttons, Look-Drag und Geräteerkennung headless.

Jedes geparkte Auto und jedes Verkehrsauto ist übernehmbar. Zielscheiben sind
Passanten, Polizisten, Autos und die Polizei selbst — jede Aktion erhöht das
Wanted-Level (max. 5 Sterne), ab 3 Sternen kommen zusätzlich Beamte zu Fuß.

## Architektur

```
openworld/
├── index.html              HUD, Overlays, Import-Map
├── style.css               HUD, Minimap-Ring, Speedometer, Menüs
├── vendor/three.module.js  three.js r169 (MIT, Lizenz beiliegend)
├── src/
│   ├── city.js             Straßenraster, Blocks, Gebäude, Bäume, Laternen (DOM-frei)
│   ├── geo.js              Box/Plane mit metrischen UVs, Geometry-Merger
│   ├── physics.js          Spatial Hash über Gebäude-AABBs, Circle-Push-Out
│   ├── world.js            Szene: Himmel-Shader, Licht, Straßenmarkierungen, Merging
│   ├── characters.js       Low-Poly-Figuren + Third-Person-Controller
│   ├── vehicle.js          Arcade-Fahrphysik (Grip/Drift) + prozedurale Auto-Meshes
│   ├── traffic.js          Spurgeführter Verkehr + Passanten auf Block-Umlaufbahn
│   ├── police.js           Wanted-System, Verfolger, Sichtlinien-Checks, Schüsse
│   ├── effects.js          Partikel-Pools, Tracer, Explosionen, Lichtblitze
│   ├── audio.js            WebAudio: Motor, Schüsse, Sirene, Hupe (keine Audiodateien)
│   ├── hud.js              Minimap, Wanted-Sterne, Speedometer, Munition
│   └── main.js             Loop, Kamera, Kampf, Spielzustände
├── assets/
│   ├── raw/                Original-Ausgaben der Bildgenerierung (1024², 2,5 MB)
│   └── tex/                Albedo-JPEGs + Normal-Maps (PNG), 512²
└── tools/prep_assets.py    Kachelbar machen, Normal-Maps ableiten, Seam-Report
└── test/                   Headless-Tests (siehe unten)
```

### Stadt-Generierung

9 × 9 Blocks à 56 m, dazwischen 18 m Straßen → **666 × 666 m**. Jeder Block
bekommt einen 4 m breiten Bürgersteig-Ring und wird dann in 1, 2 oder 4
Gebäudezellen geteilt. Die Höhe skaliert mit der Entfernung zum Zentrum
(7 m am Rand, bis ~90 m Downtown), die Fassade ebenfalls (Glas downtown,
Beton/Backstein außen). Park- und Parkplatz-Blocks sind Sonderfälle.
Getterestet: keine Überlappungen, nichts ragt in Straße oder Bürgersteig,
Spawnpunkt immer frei.

### Rendering

Die ganze Stadt ist **gemerged**: ein Mesh pro Fassadentyp, eins für Dächer,
Bürgersteige, Curbs, Markierungen — rund 10 Meshes plus 4 InstancedMeshes
(Bäume, Laternen) statt tausender Objekte. Texturen sind metrisch gemappt
(4–15 m pro Kachel), damit die Dichte unabhängig von der Gebäudegröße stimmt.
Der Himmel ist ein Custom-Shader (Dusk-Gradient + Sonnen-Halo), Schatten kommen
von einer einzigen gerichteten Lichtquelle, deren Shadow-Frustum dem Spieler folgt.
Die Fassaden bekommen per Vertex-Farbe individuelle Tönung, damit 150 Türme nicht
wie Klone wirken.

### Fahrphysik

Arcade-Modell mit **getrennter Längs- und Querachse**: Gas/Bremse wirken entlang
der Fahrzeugachse, die Querkomponente wird pro Frame weggedämpft (`grip`).
Handbremse senkt den Grip auf ~1/6 → das Auto bricht aus und driftet.
Lenkung skaliert mit Geschwindigkeit (bei Stillstand kein Einschlag, bei
Tempo gedämpft). Kollision über zwei Kreise (vorne/hinten) gegen die
Gebäude-AABBs, damit man nicht mit der Fahrzeugmitte in Wänden hängt.

Messwerte aus `test/physics.mjs`:

```
top speed after 6 s full throttle: 142 km/h
speed after 2 s braking: 23 km/h
heading change in 1.5 s of full steering: 134°
lateral slip: grip 18.9%  handbrake 86.3%
```

## Texturen

Alle sechs Texturen — Asphalt, Bürgersteig, Glas-, Beton- und Backsteinfassade,
Parkrasen — sind **KI-generiert** und danach technisch aufbereitet
(`tools/prep_assets.py`):

1. **Seamless** — an den Rändern wird eine um 180° gedrehte Kopie mit
   Smoothstep-Feather eingeblendet; die Kachelkanten gehen stetig ineinander über.
2. **Normal-Maps** — aus der Luminanz per Sobel-Operator abgeleitet (mit
   Gaussian-Blur vorher, weil Pixelrauschen sonst kaputte Normals ergibt).
3. **Power-of-Two** — Lanczos-Resize auf 512², milder Unsharp-Mask.

Seam-Report (mittlere Kantendifferenz 0–255, kleiner ist besser):

```
     asphalt  seam  23.6/ 20.2
    sidewalk  seam  19.6/ 19.5
facade-glass  seam   5.3/  1.8
```

Der Wert beim Asphalt ist unkritisch, weil die Straße im Spiel zusätzlich mit
Markierungen, Curbs und Schatten überzogen ist; die Fassaden — die sichtbar
gekachelt werden — liegen bei 1,8–5,3.

## Tests

```bash
node tools/test_city.js     # Layout-Invarianten über 60 Städte
node test/physics.mjs       # Beschleunigung, Bremsen, Lenken, Drift, Kollision
node test/smoke.mjs         # baut die komplette Welt mit Fake-DOM, simuliert 40 s Spiel
node test/textures.mjs      # Texture-Loader: löst auf, überlebt Fehler, korrekte URLs
node test/touch.mjs         # Touch-Steuerung: Deadzone, Achsen, Buttons, Look, Erkennung
node test/bootstrap.mjs     # Startpfad: Storage-Fallback, Fehlerhandler vor dem Modul
node test/boot-fatal.mjs    # echtes main.js ohne WebGL/Storage: Fehler wird sichtbar
```

Der Smoke-Test lädt alle Module mit einem nachgebauten DOM/WebGL-Stub, baut
Stadt, Szene, Figuren, Verkehr, Polizei und HUD und lässt 2400 Frames laufen —
inklusive Fahr-Simulation. Er hat beim ersten Lauf zwei echte Bugs gefunden
(Fassadentyp-Mapping zwischen Stadt und Renderer, HUD-Element-IDs).

**Silent-Freeze-Schutz.** Zwei Ausfälle haben gezeigt, wie wichtig das ist:
`localStorage` auf Modulebene wirft in einem sandboxed iframe eine
`SecurityError` und tötet das Modul, bevor irgendetwas rendert — und ein
Fehlerhandler am Dateiende registriert sich dann nie. Deshalb:

- Speicherzugriffe laufen ausschließlich über `src/storage.js` (try/catch,
  In-Memory-Fallback; ohne Storage funktionieren Einstellungen nur nicht mehr
  persistent, das Spiel läuft weiter).
- `index.html` bringt einen Inline-Handler **vor** dem Modul mit
  (`window.__lhFatal`, `error`, `unhandledrejection`).
- Ein Watchdog nach 8 s meldet, wenn das Modul gar nicht erst startet; das
  Modul meldet sich mit `__lhMarkStarted()` an, sobald es läuft.
- Die Renderer-Erzeugung ist gekapselt: fehlendes WebGL erzeugt eine lesbare
  Meldung statt eines eingefrorenen Ladebalkens.

Der Startbildschirm blockiert bewusst **nicht** auf das Laden der Texturen: die
Stadt wird sofort mit prozeduralen Platzhalter-Texturen gebaut, die echten
Texturen werden im Hintergrund nachgeladen und per `applyTextures()` in die
bereits existierenden Materialien getauscht. Ein hängender oder fehlender
Asset-Request kann den Start also nicht mehr verhindern — er kostet höchstens
Detailgrad. Der Status steht live unter dem Startmenü, „Diagnose" zeigt
Build, WebGL-Version und Szenen-Inhalte.

`test/textures.mjs` deckt den Texture-Loader separat ab, weil der Smoke-Test
fertige Texturen einspeist und diesen Pfad deshalb nicht berührt. Anlass war ein
echter Bug: der Loader wartete auf `texture.onLoad`, das three.js nie aufruft —
die Promises blieben offen und der Ladebildschirm hing für immer. Jetzt lösen die
Callbacks von `load()` die Promises auf, Fehler werden geloggt und aufgelöst,
und ein 20-Sekunden-Watchdog in `boot()` verhindert, dass ein hängender Request
die Seite blockiert.

## Bekannte Grenzen

- **Eine Stadt-Vorlage**, prozedural variiert (Seed beim Start), aber ohne
  handgebaute Landmarks, Innenräume oder Begehbarkeit von Gebäuden.
- **Keine Story, keine Missionen, keine Fahrzeugvielfalt** — ein Fahrzeugtyp,
  ein Polizeifahrzeug, Pistole.
- **Passanten** laufen auf Block-Umlaufbahnen und fliehen bei Bedrohung, sie
  haben keine echten Navmesh-Pfade oder Animation-Rigs (Beine/Arme sind Boxen).
- **Performance** hängt von der GPU ab; Schatten und Pixel-Ratio sind bewusst
  gedrosselt (max. 1,5 dpr, 2048² Shadow-Map). Auf schwachen Geräten zuerst
  `renderer.shadowMap.enabled` in `src/main.js` prüfen.
- **Kein Multiplayer**, keine Persistenz, kein Savegame.
- Das Wanted-System ist ein Arcade-Modell, keine Simulation von Polizeitaktik.

## Assets & Lizenzen

- **Texturen und alle Modelle:** KI-generiert bzw. prozedural in Code erzeugt.
  Keine Fremd-Assets, keine Lizenzfragen.
- **three.js r169:** MIT, Lizenz in `vendor/THREE-LICENSE`.
- Den Lizenzstatus der Rohbilder (`assets/raw/`, 2,5 MB) solltest du für eine
  Veröffentlichung gegen die Bedingungen deines Generator-Anbieters prüfen.

Ein direkter Download von Asset-Seiten (kenney.nl, opengameart.org) ist aus der
Sandbox nicht möglich — erreichbar sind nur GitHub, npm und PyPI. Deshalb liegt
der Schwerpunkt hier auf KI-Texturen plus prozeduraler Geometrie.
