# Warsaw Boars Defense

Przeglądarkowa gra tower defense osadzona na prawdziwych ulicach Starego Miasta w Warszawie.
Zwierzyna (dziki, lisy, jelenie, wilki i Dzik Królewski) wychodzi z dziesięciu wejść na Starówkę i idzie uliczkami do pomnika Syrenki na Rynku. Twoim zadaniem jest ją powstrzymać przez 15 fal.

Mapa 3D (MapLibre) jest tłem, a wszystko, co „growe”, to pixel art rysowany proceduralnie na canvasie, w stylu Twierdzy: Krzyżowca (2001).

## Jak grać

- **Cel:** ochroń Syrenkę przez 15 fal. Start: 20 żyć i 320 zł. Każdy wróg, który do niej dotrze, odbiera życia (Dzik Królewski aż 8). Przy zerze przegrywasz.
- **Wieże** stawiasz na zielonych polach sześciokątnych (hex) przy drogach. Pola przy samym Rynku są ograniczone, więc obrona musi sięgać dalej w uliczki Starówki.
- **Mury** stawiasz tylko na drodze. Mur zamyka całą uliczkę, a zwierzęta zatrzymują się przy nim i go rozbijają. Uszkodzony mur możesz naprawić, a koszt jest proporcjonalny do obrażeń.
- Zwierzęta **uczą się** między falami, którymi wejściami i trasami opłaca się iść (algorytm mrówkowy + bandyta). Nie widać tego w grze, ale obrona skupiona w jednym miejscu szybko zaczyna być omijana.

### Sterowanie

| Klawisz / akcja | Co robi |
|---|---|
| `1`–`5` | wybór wieży (Łucznik, Kusznik, Smoła, Balista, Bombarda) |
| `6` | mur |
| LPM na polu / drodze | budowa wybranej budowli |
| LPM na wieży lub murze | zaznaczenie (panel z ulepszeniem lub naprawą) |
| `U` | ulepsz zaznaczoną wieżę (3 poziomy) |
| `R` | napraw zaznaczony mur |
| PPM lub `Delete` / `Backspace` | sprzedaż (zwrot 60%, wieża poz. 3 wymaga potwierdzenia) |
| `Spacja` | wypuść następną falę od razu (fale startują też same) |
| `Esc` | anuluj wybór |
| kółko myszy | zoom (oddalisz najwyżej do widoku całej mapy gry) |

Kamera jest statyczna: widać całe pole gry z wszystkimi wejściami, bez przesuwania i obrotu. Po wejściu do gry pojawia się ekran startowy z krótką instrukcją, a rozgrywka rusza po kliknięciu OK.

### Wieże

| Wieża | Rola | Koszt (poz. 1) |
|---|---|---|
| Łucznik | tani i szybki, dobry na lisy | 50 zł |
| Kusznik | wolny, ale mocny strzał w pojedynczy cel | 90 zł |
| Kocioł ze smołą | krótki zasięg, obszar, spowalnia grupy | 120 zł |
| Balista | daleki zasięg, duże obrażenia w jeden cel (dziki, boss) | 170 zł |
| Bombarda | daleki zasięg, obszarowe obrażenia, bardzo wolna | 200 zł |
| Mur | blokuje uliczkę | 30 zł |

Dokładne statystyki, DPS i koszt ulepszeń pokazuje panel zaznaczonej wieży i tooltipy na przyciskach budowy.

### Zwierzyna

| Zwierzę | Cechy |
|---|---|
| Dzik | wolny i twardy, szybko rozbija mury |
| Lis | najszybszy i kruchy, mury prawie go nie zatrzymują |
| Jeleń | średni we wszystkim |
| Wilk | chodzi stadem za przewodnikiem, wspólną trasą |
| Dzik Królewski | boss w falach 10 i 15, odbiera 8 żyć |

## Uruchomienie

Wymagany jest Node.js (testowane na nowszych wersjach LTS).

```bash
npm install
npm run dev        # serwer deweloperski, domyślnie http://localhost:5173/
npm run build      # sprawdzenie typów + build produkcyjny do dist/
npm run preview    # podgląd builda
```

Parametr `?skip=1` (albo `?intro=0`) w adresie pomija ekran startowy, co przydaje się w testach i skryptach.

### Skrypty

| Komenda | Opis |
|---|---|
| `npm run level` | pobiera drogi Starówki z Overpass API (OpenStreetMap) i generuje `public/data/oldtown.json`: graf dróg, wejścia, Syrenkę i pola budowy (hex) |
| `npm run sim` | symulacja gry botami (kilka strategii) do strojenia balansu, plus asercje: zwierzęta nie mijają muru, uczenie AI działa |
| `npm run shot` | zrzuty ekranu gry przez `puppeteer-core` (do uruchomienia z `?skip=1`) |

Parametry generatora (rozmiar hexów, ograniczenie pól na Rynku, maksymalna długość krawędzi) są stałymi na górze `scripts/fetch-oldtown.mjs`. Balans (koszty, HP, fale) to `src/game/config.ts` i `src/game/waves.ts`.

## Technologia i struktura

- TypeScript, Vite, [MapLibre GL JS](https://maplibre.org/) (jedyna zależność uruchomieniowa)
- Canvas 2D dla sprite'ów (generowanych proceduralnie w kodzie), HUD w DOM
- Pętla gry o stałym kroku 0,05 s

```
src/
  main.ts          punkt wejścia, obsługa myszy i klawiatury
  map.ts           mapa MapLibre, kamera i kadr
  game/            logika: graf dróg, pathfinding, wrogowie, wieże, mury, fale, AI
  gfx/             render sprite'ów, nakładki na mapie (pola hex, wejścia)
  ui/              HUD i ekran startowy
scripts/           generator poziomu, symulacja, zrzuty ekranu
public/data/       wygenerowany poziom (oldtown.json)
```

Gra działa na prawdziwych współrzędnych geograficznych. Drogi to graf nieskierowany z krawędziami do 15 m, mur zajmuje całą krawędź, a pola pod wieże to sześciokąty wzdłuż ulic.

## Dane i atrybucja

- Drogi i budynki: © współtwórcy [OpenStreetMap](https://www.openstreetmap.org/copyright), na licencji ODbL (pobierane przez Overpass API).
- Kafelki mapy: [OpenFreeMap](https://openfreemap.org/) (styl „liberty”, przekolorowany na średniowieczny).
