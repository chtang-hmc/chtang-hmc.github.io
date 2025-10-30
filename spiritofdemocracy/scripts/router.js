export function resolveVariant() {
  const fromStorage = localStorage.getItem("sod_variant");
  if (fromStorage) return fromStorage;
  const options = ["pro", "against", "mixed"];
  const pick = options[Math.floor(Math.random() * options.length)];
  return pick;
}

export function applyRoute(variant) {
  if (!location.hash || !location.hash.includes(variant)) {
    location.hash = `#/${variant}`;
  }
  // do not show variant label UI anymore
}


