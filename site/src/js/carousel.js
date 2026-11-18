// The screenshot carousel's buttons. The track is a scroll-snap list that works
// on its own (swipe, trackpad, shift+wheel, arrow keys once focused); this only
// adds previous/next and the dots, and keeps the dots in step with the scroll.
// No autoplay: a slide that moves while someone reads its caption is a bug.

for (const root of document.querySelectorAll('[aria-roledescription="carousel"]')) {
  const track = root.querySelector("[data-carousel-track]");
  const controls = root.querySelector("[data-carousel-controls]");
  if (!track || !controls) continue;

  const slides = [...track.children];
  const dots = [...controls.querySelectorAll("[data-carousel-dot]")];
  const prev = controls.querySelector("[data-carousel-prev]");
  const next = controls.querySelector("[data-carousel-next]");
  let current = 0;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const show = (index) => {
    const target = (index + slides.length) % slides.length;
    // Taken now, not when the scroll lands, so a second click mid-scroll moves on from here.
    mark(target);
    track.scrollTo({ left: slides[target].offsetLeft, behavior: reduceMotion.matches ? "auto" : "smooth" });
  };

  const mark = (index) => {
    current = index;
    dots.forEach((dot, i) => {
      if (i === index) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
    });
  };

  // The slide most in view is the current one, however it got there.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) mark(slides.indexOf(entry.target));
      }
    },
    { root: track, threshold: 0.6 },
  );
  slides.forEach((slide) => observer.observe(slide));

  prev.addEventListener("click", () => show(current - 1));
  next.addEventListener("click", () => show(current + 1));
  dots.forEach((dot, i) => dot.addEventListener("click", () => show(i)));
  track.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") show(current - 1);
    else if (event.key === "ArrowRight") show(current + 1);
    else return;
    event.preventDefault();
  });

  mark(0);
  controls.hidden = false;
}
