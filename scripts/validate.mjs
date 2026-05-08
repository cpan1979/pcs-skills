#!/usr/bin/env node
// Validates data/*.json against schemas/*.schema.json AND performs
// cross-reference checks (every appliesTo.designation must resolve, etc.)
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const SCHEMA_DIR = path.join(root, "schemas");
const DATA_DIR = path.join(root, "data");

async function readJSON(p) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

async function main() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const desSchema = await readJSON(path.join(SCHEMA_DIR, "designations.schema.json"));
  const certSchema = await readJSON(path.join(SCHEMA_DIR, "certifications.schema.json"));
  const designations = await readJSON(path.join(DATA_DIR, "designations.json"));
  const certs = await readJSON(path.join(DATA_DIR, "certifications.json"));
  const meta = await readJSON(path.join(DATA_DIR, "meta.json"));

  let ok = true;
  const errors = [];

  const validateDes = ajv.compile(desSchema);
  if (!validateDes(designations)) {
    ok = false;
    errors.push(`designations.json schema errors:\n${ajv.errorsText(validateDes.errors, { separator: "\n  " })}`);
  }

  const validateCert = ajv.compile(certSchema);
  if (!validateCert(certs)) {
    ok = false;
    errors.push(`certifications.json schema errors:\n${ajv.errorsText(validateCert.errors, { separator: "\n  " })}`);
  }

  // Cross-reference: every cert.appliesTo.designation must exist
  const desIds = new Set(designations.designations.map((d) => d.id));
  const certIds = new Set(certs.certifications.map((c) => c.id));
  if (certIds.size !== certs.certifications.length) {
    ok = false;
    errors.push("Duplicate certification ids detected.");
  }
  for (const c of certs.certifications) {
    for (const a of c.appliesTo) {
      if (!desIds.has(a.designation)) {
        ok = false;
        errors.push(`Cert "${c.id}" references unknown designation "${a.designation}".`);
      }
    }
  }

  // Sanity: meta.json sources should reference the four expected slugs
  const expectedSourceIds = ["business-applications", "azure", "security", "modern-work"];
  const metaSourceIds = (meta.sources || []).map((s) => s.id);
  for (const id of expectedSourceIds) {
    if (!metaSourceIds.includes(id)) {
      ok = false;
      errors.push(`meta.json missing source id "${id}".`);
    }
  }

  if (ok) {
    console.log(`✔ Validated ${designations.designations.length} designations and ${certs.certifications.length} certifications.`);
    process.exit(0);
  } else {
    console.error("✘ Validation failed:");
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
