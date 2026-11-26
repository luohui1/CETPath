import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { band, fillOk, gradeSection, isAnswered, norm, roundIeltsBand, wordCount } from "./grade.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const papersDir = path.join(root, "public/ielts/papers");
const keysDir = path.join(root, "public/ielts/keys");

function perfectAnswers(kg) {
  const out = {};
  for (const [n, a] of Object.entries(kg.answers)) {
    if (kg.type === "fill") {
      const vals = a.mode === "tuple" ? a.tuples[0] : a.per.map((alts) => alts[0]);
      out[n] = a.k === 1 ? vals[0] : vals;
    } else if (kg.type === "multi") {
      out[n] = [...a.set];
    } else {
      out[n] = a.i;
    }
  }
  return out;
}

test("every section of all 144 split IELTS papers + keys grades 100% with model answers", () => {
  const files = fs.readdirSync(papersDir).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 144);
  let sections = 0;
  for (const f of files) {
    const p = JSON.parse(fs.readFileSync(path.join(papersDir, f), "utf8"));
    const k = JSON.parse(fs.readFileSync(path.join(keysDir, f), "utf8"));
    for (const skill of ["listening", "reading"]) {
      const pParts = p[skill] || [];
      const kParts = k[skill] || [];
      assert.equal(pParts.length, kParts.length);
      for (let i = 0; i < pParts.length; i++) {
        const pp = pParts[i];
        const kp = kParts[i];
        const answers = {};
        kp.groups.forEach((kg) => Object.assign(answers, perfectAnswers(kg)));
        const r = gradeSection(pp.groups, kp.groups, answers);
        assert.equal(r.raw, r.total, `${p.id} ${skill} part ${pp.part}: ${r.raw}/${r.total}`);
        for (const pg of pp.groups) {
          for (let n = pg.first; n <= pg.last; n++) {
            assert.ok(isAnswered(pg, answers, n), `${p.id} q${n} answered without key`);
          }
        }
        sections++;
      }
    }
  }
  assert.ok(sections > 600, `sections=${sections}`);
});

test("multi-select partial credit keeps 21-22 as one unit with earned/max 1/2 instead of falsely mastering Q21", () => {
  const pg = {
    type: "multi",
    first: 21,
    last: 22,
    instr: "Choose TWO letters",
    items: [{ n: 21, count: 2, text: "Which TWO?", options: ["Opt A", "Opt B", "Opt C", "Opt D", "Opt E"] }],
  };
  const kg = {
    type: "multi",
    first: 21,
    last: 22,
    answers: { "21": { set: [1, 3], first: 21, count: 2 } },
  };
  const r = gradeSection([pg], [kg], { "21": [1, 4] });
  assert.equal(r.raw, 1);
  assert.equal(r.total, 2);
  assert.equal(r.units.length, 1);
  assert.equal(r.units[0].unitKey, "21-22");
  assert.equal(r.units[0].earned, 1);
  assert.equal(r.units[0].max, 2);
  assert.equal(r.units[0].ok, false);
  assert.equal(r.perQ[21].ok, false);
  assert.equal(r.perQ[21].partial, true);
  assert.equal(r.perQ[22].ok, false);
  assert.equal(r.perQ[22].partial, true);
});

test("fill grading & band conversion rules", () => {
  assert.ok(fillOk({ k: 1, mode: "per", per: [["its branches", "branches"]] }, "Branches "));
  assert.ok(fillOk({ k: 2, mode: "per", per: [["Jupiter"], ["Saturn"]] }, ["saturn", "jupiter"]));
  assert.ok(!fillOk({ k: 2, mode: "per", per: [["Jupiter"], ["Saturn"]] }, ["saturn", "saturn"]));
  assert.ok(fillOk({ k: 1, mode: "per", per: [["keep-fit studio"]] }, "keep fit studio"));
  assert.equal(norm("  “Hello”, "), "hello");
  assert.equal(band("listening", 30, 40), 7);
  assert.equal(band("reading", 30, 40, true), 6);
  assert.equal(band("reading", 21, 42), 5.5);
  assert.equal(roundIeltsBand(6.25), 6.5);
  assert.equal(roundIeltsBand(6.75), 7);
  assert.equal(wordCount("  one two\nthree  "), 3);
});
