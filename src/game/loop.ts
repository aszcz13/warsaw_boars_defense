const STEP = 0.05;
const MAX_FRAME = 0.25;
let speed = 1;

export function setSpeed(n: number): void {
  speed = n;
}

export function startLoop(update: (dt: number) => void, render: () => void): void {
  let last = performance.now();
  let acc = 0;
  const frame = (now: number) => {
    acc += Math.min((now - last) / 1000, MAX_FRAME) * speed;
    last = now;
    let n = 0;
    while (acc >= STEP && n++ < 20) {
      update(STEP);
      acc -= STEP;
    }
    if (acc > STEP) acc = 0;
    render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
