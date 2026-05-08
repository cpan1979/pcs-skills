// Loads the JSON data and exposes a small reactive store.

const DATA_FILES = {
  designations: "data/designations.json",
  certifications: "data/certifications.json",
  meta: "data/meta.json"
};

const TRACK_KEY = "pcs.track";

class Store extends EventTarget {
  constructor() {
    super();
    this.designations = [];
    this.designationsById = new Map();
    this.certifications = [];
    this.certificationsById = new Map();
    this.meta = null;
    this.track = (typeof localStorage !== "undefined" && localStorage.getItem(TRACK_KEY)) || "enterprise";
    this.loaded = false;
    this.loadError = null;
  }

  async load() {
    try {
      const [d, c, m] = await Promise.all(
        Object.values(DATA_FILES).map((p) => fetch(p, { cache: "no-store" }).then((r) => {
          if (!r.ok) throw new Error(`${p}: ${r.status}`);
          return r.json();
        }))
      );

      this.designations = d.designations;
      this.designationsById = new Map(d.designations.map((x) => [x.id, x]));

      this.certifications = c.certifications.slice().sort((a, b) => a.name.localeCompare(b.name));
      this.certificationsById = new Map(this.certifications.map((x) => [x.id, x]));

      this.meta = m;
      this.loaded = true;
      this.dispatchEvent(new CustomEvent("loaded"));
    } catch (err) {
      console.error(err);
      this.loadError = err;
      this.dispatchEvent(new CustomEvent("error", { detail: err }));
    }
  }

  setTrack(track) {
    if (track !== "smb" && track !== "enterprise") return;
    if (this.track === track) return;
    this.track = track;
    try { localStorage.setItem(TRACK_KEY, track); } catch {}
    this.dispatchEvent(new CustomEvent("track-change", { detail: track }));
  }

  // Returns the list of certs that apply to a given designation, with each
  // cert paired with its single relevant `appliesTo` entry.
  certsForDesignation(designationId) {
    const out = [];
    for (const cert of this.certifications) {
      for (const a of cert.appliesTo) {
        if (a.designation === designationId) out.push({ cert, applies: a });
      }
    }
    return out;
  }

  // For a given cert, returns the list of (designation, applies) pairs in
  // canonical designation order.
  applicationsFor(certId) {
    const cert = this.certificationsById.get(certId);
    if (!cert) return [];
    const order = new Map(this.designations.map((d, i) => [d.id, i]));
    return cert.appliesTo
      .map((a) => ({ designation: this.designationsById.get(a.designation), applies: a }))
      .filter((x) => x.designation)
      .sort((x, y) => order.get(x.designation.id) - order.get(y.designation.id));
  }
}

export const store = new Store();
