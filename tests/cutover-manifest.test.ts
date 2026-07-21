import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  loadCutoverManifest,
  reviewManifestAgainstSitesTsv,
} from "../deploy/manifest";

const exactDomains = [
  "3d.oceanleo.com",
  "agent.oceanleo.com",
  "aihuman.oceanleo.com",
  "aitools.oceanleo.com",
  "asset.oceanleo.com",
  "bizdev.oceanleo.com",
  "chat.oceanleo.com",
  "converter.oceanleo.com",
  "design.oceanleo.com",
  "e-commerce.oceanleo.com",
  "edu.oceanleo.com",
  "excel.oceanleo.com",
  "game.oceanleo.com",
  "image.oceanleo.com",
  "interior.oceanleo.com",
  "law.oceanleo.com",
  "logo.oceanleo.com",
  "make.oceanleo.com",
  "meeting.oceanleo.com",
  "money.oceanleo.com",
  "music.oceanleo.com",
  "myselfie.oceanleo.com",
  "novel.oceanleo.com",
  "paper.oceanleo.com",
  "ppt.oceanleo.com",
  "remove.oceanleo.com",
  "resume.oceanleo.com",
  "script.oceanleo.com",
  "search.oceanleo.com",
  "skill.oceanleo.com",
  "slide.oceanleo.com",
  "studio.oceanleo.com",
  "study.oceanleo.com",
  "threed.oceanleo.com",
  "video.oceanleo.com",
  "website.oceanleo.com",
  "word.oceanleo.com",
].sort();

const exactLegacyProjectIds: Readonly<Record<string, string>> = {
  agent: "prj_tPPZb5PSwykt00Ia4DIKSIBLtQeo",
  website: "prj_pTBArlyTCa46sVq6n9R8enGIdho8",
  ecommerce: "prj_CxdDA2wwLchBWhifVuCIXvWZQb6z",
  ppt: "prj_fg9lw6bqU6y8fdrlho4tRQ1lqks4",
  excel: "prj_BMpaAMd1l93r4AGlgO67nFc0SJF3",
  word: "prj_Ls4e3jgAbyfULtKsIQUUhfAzqwxe",
  converter: "prj_irJcqq4OYf6QuxqWOma7Is5M09iZ",
  aihuman: "prj_STY31vfacHf9EwT94xsoEpySSU0S",
  image: "prj_dH7qSVH47xmryN0Fkg1zaMRlk0p0",
  video: "prj_fL2HXBjq1vy3Lg8M9pynSz0oLBDX",
  resume: "prj_pHf6q3mNk7SL1zY2VZJSBO6MMGL0",
  bizdev: "prj_9f2LiGjl60KPGz1UKpkxY1YFwggG",
  logo: "prj_KfpZVQSA9F1DgamGXEYweKjLZfwR",
  interior: "prj_iD0gbYfgb2WSAgmIWo8d1FbtLN8r",
  chat: "prj_hrsYhiD7JsdCQBbFlRFbkThnNDt8",
  threed: "prj_pRg3mRmEGBwq9o4i13HpF3K7lENQ",
  music: "prj_UDTSmZjOw9m6OQ7vFoeGFMtEPCbI",
  meeting: "prj_ofG2j6zreM8Ai32tZZwSO8MBt7H4",
  paper: "prj_dZUDcrgdqIKnD5nXV3v8R36gXDyB",
  law: "prj_Mh2rmPFaGhkxv3s6bU2LqZUDPEDV",
  study: "prj_jSiaQIQBIp2mNt1tQhRnlkIohKBI",
  edu: "prj_YHIsv2LvNhiMR8jszFJdGphkbWQv",
  novel: "prj_aIrZeIvHdgP78zsdFqDmuWZt1AIt",
  script: "prj_LyRLZyrI2KN4byYAZedsfuF3j1FF",
  design: "prj_AqsWpNFVnmQB5kEuak9RRhjP6uLz",
  make: "prj_n1ugKK5Vbcol7jZptQkEoCJf9VPf",
  search: "prj_R6ZnDNb4PXbkBKqHz7caGccl7CCX",
  money: "prj_8nqgiHjeRgmackwJ9u1GyC31f5SD",
  aitools: "prj_c00tOhsH7bYuoXQdggRd4i8YELV3",
  asset: "prj_ZETpQJA1DIDuLNT2f5eZSKwCAbQH",
  game: "prj_f57D46LMVqerRVbH4pD8zLFjyA6q",
};

test("immutable manifest covers every exact domain and legacy owner once", async () => {
  const loaded = await loadCutoverManifest();
  assert.equal(loaded.digest.length, 64);
  assert.deepEqual(
    loaded.domains.map((domain) => domain.host).sort(),
    exactDomains,
  );
  assert.equal(new Set(loaded.domains.map((domain) => domain.host)).size, 37);
  assert.equal(
    loaded.domains.filter((domain) => domain.profile === "standard").length,
    36,
  );
  assert.equal(
    loaded.domains.filter(
      (domain) => domain.profile === "website-privileged",
    ).length,
    1,
  );
  assert.deepEqual(
    Object.fromEntries(
      loaded.manifest.legacyProjects.map((project) => [
        project.siteKey,
        project.projectId,
      ]),
    ),
    exactLegacyProjectIds,
  );
  assert.ok(
    loaded.domains.every(
      (domain) =>
        domain.rollbackOwnerProjectId === domain.legacyProjectId,
    ),
  );
});

test("waves are ordered, aliases lead canonicals, and ppt rollback restores 308", async () => {
  const loaded = await loadCutoverManifest();
  assert.deepEqual(
    loaded.manifest.waves.map((wave) => wave.id),
    ["W1", "W2", "W3", "W4", "W5", "W6", "W7"],
  );
  assert.deepEqual(
    loaded.manifest.waves.map(
      (wave) =>
        loaded.domains.filter((domain) => domain.wave === wave.id).length,
    ),
    [1, 6, 10, 6, 5, 8, 1],
  );
  for (const siteKey of new Set(
    loaded.domains.map((domain) => domain.siteKey),
  )) {
    const domains = loaded.domains.filter(
      (domain) => domain.siteKey === siteKey,
    );
    const canonical = domains.findIndex(
      (domain) => domain.kind === "canonical",
    );
    assert.ok(canonical >= 0);
    assert.ok(
      domains.every(
        (domain, index) =>
          domain.kind !== "alias" || index < canonical,
      ),
      siteKey,
    );
  }
  const ppt = loaded.domains.find(
    (domain) => domain.host === "ppt.oceanleo.com",
  );
  assert.ok(ppt);
  assert.deepEqual(ppt.forwardConfiguration, {
    gitBranch: null,
    redirect: "slide.oceanleo.com",
    redirectStatusCode: 308,
  });
  assert.deepEqual(ppt.rollbackConfiguration, ppt.forwardConfiguration);
});

test("target profiles and sites TSV are exact and value-free", async () => {
  const loaded = await loadCutoverManifest();
  const tsv = await readFile(
    "/opt/cursor-workspaces/oceandino/scripts/oceanleo-sites.tsv",
    "utf8",
  );
  assert.deepEqual(reviewManifestAgainstSitesTsv(loaded, tsv), {
    consumers: 31,
    domains: 37,
  });
  assert.equal(
    loaded.manifest.targets.standard.projectName,
    "oceanleo-sites-standard",
  );
  assert.equal(
    loaded.manifest.targets["website-privileged"].projectName,
    "oceanleo-sites-website-privileged",
  );
  assert.equal(
    loaded.manifest.targets.standard.environment.forbidden.includes(
      "WEBSITE_VERCEL_TOKEN",
    ),
    true,
  );
  for (const target of Object.values(loaded.manifest.targets)) {
    assert.equal(target.nodeVersion, "24.x");
    assert.equal(target.productionBranch, "main");
    for (const name of [
      ...target.environment.required,
      ...target.environment.forbidden,
    ]) {
      assert.match(name, /^[A-Z][A-Z0-9_]*$/);
      assert.equal(name.includes("="), false);
    }
  }
});

test("package plan binds HEAD explicitly and environment sync stays explicit", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };
  assert.match(
    packageJson.scripts["cutover:plan"] ?? "",
    /plan --sha "\$\(git rev-parse HEAD\)"/,
  );
  assert.equal(
    packageJson.scripts["cutover:sync-env"],
    "tsx scripts/cutover-controller.ts sync-env",
  );
  assert.doesNotMatch(
    packageJson.scripts["cutover:sync-env"] ?? "",
    /--execute/,
  );
});
