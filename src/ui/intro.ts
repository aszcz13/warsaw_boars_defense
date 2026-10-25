import { START_LIVES, START_GOLD, TOWER_STATS, WALL_STATS } from '../game/config';

const CSS = `
body.intro-on #map, body.intro-on #game, body.intro-on #hud{filter:brightness(.45);pointer-events:none!important}
#map, #game, #hud{transition:filter .6s ease}
.intro{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;font-family:'HudNum','Pixelify Sans','Courier New',monospace;transition:opacity .6s ease;cursor:default}
.intro.out{opacity:0;pointer-events:none}
.intro .box{display:flex;flex-direction:column;width:min(680px,100%);max-height:100%;box-sizing:border-box;background:#e2cd9e linear-gradient(#e8d6a8,#d9c28c);color:#2e1c0a;border:5px solid #1c1008;box-shadow:inset 0 0 0 2px #8a6a3c,inset 0 0 0 4px #2a1a0a,0 8px 0 rgba(0,0,0,.55),0 0 40px rgba(0,0,0,.6)}
.intro .head{background:#4a2e18 linear-gradient(#5a3a1e,#3e2612);color:#f0e0b0;padding:10px 18px;text-align:center;border-bottom:4px solid #1c1008}
.intro h1{margin:0;font-size:26px;letter-spacing:1px;text-shadow:0 2px 0 #1c1008}
.intro .sub{font-size:13px;color:#d8bd80;margin-top:2px}
.intro .body{overflow-y:auto;padding:12px 20px;font-size:15px;line-height:1.35;flex:1 1 auto;min-height:0}
.intro p{margin:0 0 8px}
.intro h2{margin:10px 0 4px;font-size:16px;color:#6a3a10}
.intro ul{margin:0;padding-left:20px}
.intro li{margin:2px 0}
.intro kbd{font-family:inherit;font-weight:700;background:#4a2e18;color:#f0e0b0;border-radius:3px;padding:0 5px;font-size:13px}
.intro .tw{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:2px 14px;margin:0;padding:0;list-style:none}
.intro .foot{padding:10px;text-align:center;border-top:3px solid #3a2410;background:rgba(58,36,16,.12)}
.intro button{font:inherit;font-size:20px;font-weight:700;color:#f0e0b0;background:#4a2e18 linear-gradient(#6a4424,#3e2612);border:4px solid #1c1008;box-shadow:inset 0 0 0 2px #8a6a3c,0 3px 0 rgba(0,0,0,.55);padding:6px 48px;cursor:pointer}
.intro button:hover,.intro button:focus-visible{background:#7a5030;outline:3px solid #ffd24a;outline-offset:2px}
@media (max-height:700px){.intro h1{font-size:22px}.intro .body{font-size:14px;padding:8px 16px}.intro h2{margin-top:6px}.intro .head{padding:6px 14px}}
`;

/** Pokazuje ekran startowy; resolve po kliknięciu OK/Enter i zakończeniu płynnego odsłonięcia gry.
 *  Parametr URL ?skip=1 lub ?intro=0 pomija ekran (testy, skrypty). Bez localStorage: pojawia się przy każdym wejściu. */
export function showIntro(totalWaves: number): Promise<void> {
  const qs = new URLSearchParams(location.search);
  if (qs.get('skip') === '1' || qs.get('intro') === '0') return Promise.resolve();

  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
  document.body.classList.add('intro-on');

  const tw = (['lucznik', 'kusznik', 'smola', 'balista', 'bombarda'] as const)
    .map((k, i) => `<li><kbd>${i + 1}</kbd> ${TOWER_STATS[k].name} · ${TOWER_STATS[k].levels[0].cost} zł</li>`)
    .join('');

  const root = document.createElement('div');
  root.className = 'intro';
  root.innerHTML = `
<div class="box" role="dialog" aria-modal="true" aria-labelledby="intro-t" aria-describedby="intro-d">
  <div class="head"><h1 id="intro-t">Warsaw Boars Defense</h1><div class="sub">Obrona Starówki Warszawy</div></div>
  <div class="body">
    <p id="intro-d">Zwierzęta wypuszczone na Starówkę - dziki, lisy, jelenie, wilki i sam Dzik Królewski - ruszyły na Rynek Starego Miasta. Obroń Syrenkę przez ${totalWaves} fal. Masz ${START_LIVES} żyć i ${START_GOLD} zł na start; każde zwierzę, które dotrze do Syrenki, zabiera życie (Dzik Królewski aż 8).</p>
    <h2>Jak grać</h2>
    <ul>
      <li>Wieże buduj klawiszami <kbd>1</kbd>-<kbd>5</kbd> (albo z paska), a potem klikaj LPM na zielonych polach przy drodze. PPM lub <kbd>Esc</kbd> anuluje wybór.</li>
      <li>Mur (<kbd>6</kbd>, ${WALL_STATS.cost} zł) stawiasz tylko na drodze - blokuje uliczkę, ale wrogowie go rozbijają. Uszkodzony mur naprawisz zaznaczając go i klawiszem <kbd>R</kbd> (koszt zależy od zniszczeń).</li>
      <li>Zaznaczoną wieżę ulepszysz klawiszem <kbd>U</kbd> (3 poziomy), sprzedasz PPM lub <kbd>Delete</kbd> (zwrot 60%).</li>
      <li>Falę startujesz <kbd>Spacją</kbd> lub przyciskiem; fale ruszają też same po przerwie. Za pokonane zwierzęta dostajesz złoto.</li>
      <li>Kółko myszy przybliża i oddala mapę.</li>
      <li>Zwierzęta wchodzą na Starówkę różnymi wejściami i uczą się, gdzie obrona jest najsłabsza - nie zostawiaj żadnej uliczki bez osłony.</li>
    </ul>
    <h2>Wieże</h2>
    <ul class="tw">${tw}<li><kbd>6</kbd> Mur · ${WALL_STATS.cost} zł</li></ul>
  </div>
  <div class="foot"><button type="button" class="ok">OK</button></div>
</div>`;
  document.body.appendChild(root);
  const ok = root.querySelector<HTMLButtonElement>('.ok')!;
  ok.focus();

  return new Promise((resolve) => {
    let done = false;
    // Faza przechwytywania: gra nie dostaje klawiszy (Spacja, 1-6, ...) dopóki popup jest otwarty.
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key === 'Enter') { e.preventDefault(); if (e.type === 'keydown') finish(); return; }
      if (e.key === 'Tab') { e.preventDefault(); ok.focus(); }
      else if (e.key === ' ' && e.type === 'keydown') e.preventDefault();
    };
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('keypress', onKey, true);
      root.classList.add('out');
      document.body.classList.remove('intro-on');
      window.setTimeout(() => {
        root.remove();
        st.remove();
        resolve();
      }, 650);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('keypress', onKey, true);
    ok.addEventListener('click', finish);
  });
}
