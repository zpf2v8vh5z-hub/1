# Runenlicht — Texture-Demo

Ein kleines, spielbares Top-Down-Dungeon, gebaut um zu zeigen, wie weit man mit
**KI-generierten Texturen** kommt. Kein Build-Schritt, keine Frameworks: reines
Canvas 2D plus eine Handvoll generierter Bilder.

```
game/
├── index.html            Einstiegspunkt
├── style.css             HUD, Menü, Touch-Controls
├── src/
│   ├── dungeon.js        Raumgenerator (DOM-frei, unit-testbar)
│   └── main.js           Game-Loop, Licht, Partikel, Gegner
├── tools/
│   ├── prep_assets.py    macht aus Rohbildern kachelbare Spiel-Assets
│   └── test_dungeon.js   prüft 200 Karten auf vollständige Erreichbarkeit
└── assets/
    ├── raw/              Original-Ausgaben der Bildgenerierung (1024x1024)
    ├── floor.jpg         512x512, nahtlos kachelbar
    ├── wall.jpg          512x512, nahtlos kachelbar
    ├── crate.jpg         512x512, nahtlos kachelbar
    └── hero.jpg          320x320, HUD-Portrait
```

## Starten

```bash
cd game && python3 -m http.server 8080 --bind 0.0.0.0
# dann http://localhost:8080 öffnen
```

## Steuerung

| Eingabe | Aktion |
| --- | --- |
| WASD / Pfeiltasten | Bewegen |
| Leertaste | Ausweichen (durch Schatten hindurch bannen, Kisten zerstören) |
| P / Tab-Wechsel | Pause |
| Touch | Virtueller Stick + Ausweich-Knopf (erscheint auf Touch-Geräten) |

Ziel: alle **5 Runen** einsammeln, dann ins Portal im entferntesten Raum.
Kisten geben gelegentlich Leben zurück, Schatten nehmen Leben.

## Asset-Pipeline

Die vier Ausgangsbilder wurden mit Bildgenerierung erzeugt und danach technisch
aufbereitet (`tools/prep_assets.py`):

1. **Nahtlosigkeit** — an den Rändern wird eine gespiegelte Kopie mit
   Smoothstep-Feather eingeblendet, sodass die Kachelkanten stetig ineinander
   übergehen (max. 50 % Beimischung, damit keine Details weggewaschen werden).
2. **Power-of-Two** — Lanczos-Resize auf 512×512.
3. **Schärfe & Größe** — milder Unsharp-Mask, progressive JPEGs (66–85 KB).

`prep_assets.py` gibt zusätzlich einen **Seam-Check** aus (mittlere
Farbdifferenz zwischen gegenüberliegenden Kanten — kleiner ist besser):

```
seam check floor.jpg: left/right=13.1  top/bottom=9.7
seam check wall.jpg:  left/right=9.4   top/bottom=19.9
seam check crate.jpg: left/right=9.9   top/bottom=6.8
```

Im Spiel werden die Kacheln zusätzlich zufällig rotiert/gespiegelt und pro Tile
leicht abgedunkelt, damit kein sichtbares Raster entsteht. Alles, was nicht
Textur ist — Lichtkegel, Runen, Schatten, Partikel, Vignette, Kistenkanten —
wird prozedural auf dem Canvas gezeichnet.

## Tests

```bash
node tools/test_dungeon.js
# checked 200 maps
# rooms per map: 10..15
# min walkable tiles: 589
# all maps fully connected
```

## Herkunft der Assets

Alle Texturen und das Portrait sind **KI-generiert** für dieses Projekt; es sind
keine Fremd-Assets enthalten. Die Rohbilder liegen unter `assets/raw/`, damit
sich der Aufbereitungsschritt jederzeit reproduzieren lässt. Für ein Release
solltest du die Lizenzbedingungen deines Generator-Anbieters prüfen und
`assets/raw/` bei Bedarf aus dem Repo nehmen (rd. 9 MB).

Warum nicht heruntergeladen? Aus der Sandbox sind nur GitHub, npm und PyPI
erreichbar — Asset-Seiten wie kenney.nl oder opengameart.org antworten nicht.
Der Weg über KI-Generierung ist hier also nicht nur der konsistenteste, sondern
auch der einzige mit sauberer Lizenzlage.
