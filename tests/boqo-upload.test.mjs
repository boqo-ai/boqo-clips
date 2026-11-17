// node --test tests/boqo-upload.test.mjs (copied from boqo-ai/boqount, MIT)
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audioContentTypeOf, captionFilename, contentTypeOf, probeVerdict, partsFromReply, putParts, run } from "../engine/boqo-upload-lib.mjs";

const FEED = {
  streams: [
    { codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p", width: 1080, height: 1920, r_frame_rate: "60/1", has_b_frames: 0 },
    { codec_type: "audio", codec_name: "aac" },
  ],
  format: { duration: "12.5", size: "15000000" },
};
const MB15 = 15_000_000;
const withVideo = (patch) => ({
  ...FEED,
  streams: [{ ...FEED.streams[0], ...patch }, FEED.streams[1]],
});

test("captionFilename keeps a caption line and adds .mp4", () => {
  const text = "The stream is eight hours long. Comment CLIPS and I'll send you the link #clipping";
  assert.equal(captionFilename(text), text + ".mp4");
});

test("captionFilename refuses what boqo would rewrite or cut", () => {
  for (const bad of ["a-b c", "a_b c", "line\nbreak here", "a/b c", "", "x ".repeat(101), "2026-11-10-reach-ratio", "reachratio"]) {
    assert.throws(() => captionFilename(bad), undefined, JSON.stringify(bad));
  }
});

test("contentTypeOf maps the four containers", () => {
  assert.equal(contentTypeOf("a/b.mp4"), "video/mp4");
  assert.equal(contentTypeOf("a/b.MOV"), "video/quicktime");
  assert.equal(contentTypeOf("b.mkv"), "video/x-matroska");
  assert.equal(contentTypeOf("b.webm"), "video/webm");
  assert.throws(() => contentTypeOf("b.avi"));
});

test("probeVerdict passes a feed file", () => {
  const v = probeVerdict(FEED, MB15);
  assert.equal(v.passthrough, true);
  assert.equal(v.loopSafe, true);
  assert.deepEqual(v.reasons, []);
  assert.equal(v.durationSec, 12.5);
  assert.deepEqual(v.video, { codec: "h264", pixFmt: "yuv420p", fps: 60, width: 1080, height: 1920, bFrames: 0 });
  assert.deepEqual(v.audio, { codec: "aac" });
});

test("probeVerdict names each re-encode reason", () => {
  const big = probeVerdict(withVideo({ codec_name: "hevc", pix_fmt: "yuv420p10le", width: 2160, height: 3840 }), MB15);
  assert.equal(big.passthrough, false);
  for (const r of ["video hevc", "pix_fmt yuv420p10le", "width 2160 > 1920"]) assert.ok(big.reasons.includes(r), r);
  assert.ok(probeVerdict(withVideo({ r_frame_rate: "120/1" }), MB15).reasons.includes("fps 120 > 60"));
  const opus = { ...FEED, streams: [FEED.streams[0], { codec_type: "audio", codec_name: "opus" }] };
  assert.ok(probeVerdict(opus, MB15).reasons.includes("audio opus"));
  assert.ok(probeVerdict(FEED, 2_147_483_649).reasons.includes("over 2 GiB"));
});

test("probeVerdict mirrors boqo's fps floor and its 1920x3840 box", () => {
  const slow = probeVerdict(withVideo({ r_frame_rate: "15/1" }), MB15);
  assert.equal(slow.passthrough, false);
  assert.ok(slow.reasons.includes("fps 15 < 23"));
  assert.ok(probeVerdict(withVideo({ r_frame_rate: "0/0" }), MB15).reasons.includes("fps 0 < 23"));
  assert.equal(probeVerdict(withVideo({ r_frame_rate: "24000/1001" }), MB15).passthrough, true);
  const phone = probeVerdict(withVideo({ width: 1080, height: 2160 }), MB15);
  assert.equal(phone.passthrough, true);
  assert.deepEqual(phone.reasons, []);
  assert.ok(probeVerdict(withVideo({ width: 1080, height: 3842 }), MB15).reasons.includes("height 3842 > 3840"));
  assert.ok(probeVerdict(withVideo({ pix_fmt: undefined }), MB15).reasons.includes("pix_fmt null"));
});

test("probeVerdict flags B-frames as a loop risk", () => {
  const v = probeVerdict(withVideo({ has_b_frames: 2 }), MB15);
  assert.equal(v.loopSafe, false);
  assert.equal(v.passthrough, true);
});

test("partsFromReply refuses an expired or partial reply", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const good = () => ({
    projectId: "p1",
    expiresAt: "2026-11-12T12:00:00Z",
    parts: [
      { partNumber: 1, offset: 0, size: 4, url: "https://r2.example/1" },
      { partNumber: 2, offset: 4, size: 6, url: "https://r2.example/2" },
    ],
  });
  assert.equal(partsFromReply(good(), 10, now).length, 2);
  assert.throws(() => partsFromReply({ ...good(), expiresAt: "2026-11-10T11:59:59Z" }, 10, now), /expired/);
  const gap = good();
  gap.parts[1].offset = 5;
  assert.throws(() => partsFromReply(gap, 10, now), /cover/);
  assert.throws(() => partsFromReply(good(), 11, now), /cover/);
  const noProject = good();
  delete noProject.projectId;
  assert.throws(() => partsFromReply(noProject, 10, now), /create_upload/);
});

async function tmpFile(bytes) {
  const dir = await mkdtemp(join(tmpdir(), "boqo-upload-"));
  const path = join(dir, "v.mp4");
  await writeFile(path, bytes);
  return { dir, path };
}

test("putParts sends exactly size bytes and no content-type", async () => {
  const { dir, path } = await tmpFile(Buffer.from("0123456789"));
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.statusCode = 200;
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const parts = [
      { partNumber: 1, offset: 0, size: 4, url: `${base}/p1` },
      { partNumber: 2, offset: 4, size: 4, url: `${base}/p2` },
      { partNumber: 3, offset: 8, size: 2, url: `${base}/p3` },
    ];
    const out = await putParts(path, parts, { fetch, sleep: async () => {} });
    assert.deepEqual(out, { ok: true, bytes: 10 });
    assert.equal(seen.length, 3);
    for (const [i, p] of parts.entries()) {
      assert.equal(seen[i].method, "PUT");
      assert.equal(seen[i].headers["content-length"], String(p.size));
      assert.equal(seen[i].headers["content-type"], undefined);
      assert.equal(seen[i].body.toString(), "0123456789".slice(p.offset, p.offset + p.size));
    }
  } finally {
    server.close();
    await rm(dir, { recursive: true });
  }
});

test("putParts retries a 5xx and stops on a 4xx", async () => {
  const { dir, path } = await tmpFile(Buffer.from("0123456789"));
  try {
    const calls = [];
    const answers = { "https://x/1": [503, 200], "https://x/2": [403, 200] };
    const fakeFetch = async (url) => {
      calls.push(url);
      return { status: answers[url].shift() };
    };
    const sleeps = [];
    const sleep = async (ms) => void sleeps.push(ms);
    const parts = [
      { partNumber: 1, offset: 0, size: 5, url: "https://x/1" },
      { partNumber: 2, offset: 5, size: 5, url: "https://x/2" },
    ];
    const out = await putParts(path, parts, { fetch: fakeFetch, sleep });
    assert.deepEqual(out, { ok: false, partNumber: 2, status: 403 });
    assert.deepEqual(calls, ["https://x/1", "https://x/1", "https://x/2"]);
    assert.deepEqual(sleeps, [1000]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("run put never prints a URL", async () => {
  const { dir, path } = await tmpFile(Buffer.from("0123456789"));
  try {
    const reply = {
      projectId: "p1",
      expiresAt: "2026-11-12T12:00:00Z",
      parts: [
        { partNumber: 1, offset: 0, size: 4, url: "https://r2.example/a?X-Amz-Signature=abc" },
        { partNumber: 2, offset: 4, size: 4, url: "https://r2.example/b?X-Amz-Signature=abc" },
        { partNumber: 3, offset: 8, size: 2, url: "https://r2.example/c?X-Amz-Signature=abc" },
      ],
    };
    const replyPath = join(dir, "reply.json");
    await writeFile(replyPath, JSON.stringify(reply));
    const deps = {
      exec: async () => assert.fail("no ffprobe"),
      fetch: async () => ({ status: 200 }),
      sleep: async () => {},
      readFile,
      stat,
      now: () => new Date("2026-11-10T12:00:00Z"),
    };
    const { code, line } = await run(["put", path, "--reply", replyPath], deps);
    assert.equal(code, 0);
    assert.ok(!line.includes("http") && !line.includes("X-Amz"));
    assert.deepEqual(JSON.parse(line), { ok: true, projectId: "p1", parts: 3, bytes: 10 });

    // A failing part and a bad reply file stay URL-free too.
    const failing = await run(["put", path, "--reply", replyPath], { ...deps, fetch: async () => ({ status: 403 }) });
    assert.equal(failing.code, 1);
    assert.deepEqual(JSON.parse(failing.line), { ok: false, projectId: "p1", partNumber: 1, status: 403 });
    await writeFile(replyPath, '{"projectId": "p1", "url": "https://r2.example/?X-Amz-Signature=abc" oops');
    const bad = await run(["put", path, "--reply", replyPath], deps);
    assert.equal(bad.code, 1);
    assert.ok(!bad.line.includes("http") && !bad.line.includes("X-Amz"));
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("run probe reads ffprobe's JSON", async () => {
  const calls = [];
  const deps = {
    exec: async (file, args) => {
      calls.push([file, args]);
      return { stdout: JSON.stringify(FEED) };
    },
    stat: async () => ({ size: MB15 }),
    now: () => new Date(),
  };
  const { code, line } = await run(["probe", "/clips/today.mp4"], deps);
  assert.equal(code, 0);
  assert.equal(calls[0][0], "ffprobe");
  assert.ok(calls[0][1].includes("/clips/today.mp4"));
  const out = JSON.parse(line);
  assert.equal(out.contentType, "video/mp4");
  assert.equal(out.passthrough, true);
  assert.equal(out.sizeBytes, MB15);
  assert.equal(out.file, "/clips/today.mp4");
});

test("run probe reads any container, and names one boqo does not take", async () => {
  const deps = {
    exec: async () => ({ stdout: JSON.stringify(FEED) }),
    stat: async () => ({ size: MB15 }),
    now: () => new Date(),
  };
  const { code, line } = await run(["probe", "/clips/old.avi"], deps);
  assert.equal(code, 0, line);
  const out = JSON.parse(line);
  assert.equal(out.contentType, null);
  assert.equal(out.passthrough, false);
  assert.equal(out.reasons[0], "unsupported container: .avi");
  assert.equal(out.durationSec, 12.5);
});

test("probeVerdict names Instagram's 300 MB cap", () => {
  // boqo's Instagram file-size limit is in decimal bytes, and exactly 300 MB passes.
  const at = probeVerdict(FEED, 300_000_000);
  assert.equal(at.passthrough, true);
  assert.deepEqual(at.reasons, []);
  const over = probeVerdict(FEED, 300_000_001);
  assert.equal(over.passthrough, false);
  assert.ok(over.reasons.includes("over 300 MB (Instagram)"), over.reasons.join("; "));
  assert.ok(probeVerdict(FEED, 2_147_483_649).reasons.includes("over 2 GiB"));
});

test("run caption gives the words for each platform, as hosted writes them from a title and a hook", async () => {
  const { code, line } = await run(["caption", "--title", "The eight hour stream", "--hook", "He did not see this coming", "--tags", "#clips, gaming"], {});
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(line), {
    tiktok: { text: "He did not see this coming\n\nThe eight hour stream\n\n#clips #gaming" },
    instagram: { text: "He did not see this coming\n\nThe eight hour stream\n\n#clips #gaming" },
    youtube: { title: "The eight hour stream", text: "He did not see this coming\n\n#clips #gaming" },
  });
  const bare = JSON.parse((await run(["caption", "--title", "Only a title"], {})).line);
  assert.deepEqual(bare.tiktok, { text: "Only a title" });
  assert.deepEqual(bare.youtube, { title: "Only a title", text: "" });
});

test("run caption refuses a missing title, a stray argument and a tag with a space", async () => {
  for (const args of [["caption"], ["caption", "--hook", "h"], ["caption", "--title", "t", "extra"], ["caption", "--title", "t", "--tags", "two words"]]) {
    const { code, line } = await run(args, {});
    assert.equal(code, 1, args.join(" "));
    assert.ok(JSON.parse(line).error);
  }
});

// ---- audio for boqo's transcribe tool

test("audioContentTypeOf maps the containers boqo's transcribe measures, and refuses mp3, raw aac and video", () => {
  assert.equal(audioContentTypeOf("/r/audio.m4a"), "audio/mp4");
  assert.equal(audioContentTypeOf("/r/audio.WEBM"), "audio/webm");
  assert.equal(audioContentTypeOf("a.opus"), "audio/ogg");
  assert.equal(audioContentTypeOf("a.ogg"), "audio/ogg");
  assert.equal(audioContentTypeOf("a.flac"), "audio/flac");
  assert.equal(audioContentTypeOf("a.wav"), "audio/wav");
  for (const name of ["a.mp3", "a.aac", "a.mp4", "a"]) assert.throws(() => audioContentTypeOf(name), /m4a, webm, ogg, opus, flac or wav/, name);
});

test("run probe-audio gives the size, the content type and the length of an audio file; a file with video is refused", async () => {
  const audio = { streams: [{ codec_type: "audio", codec_name: "aac" }], format: { duration: "1501.2" } };
  const deps = { exec: async () => ({ stdout: JSON.stringify(audio) }), stat: async () => ({ size: 12_000_000 }), now: () => new Date() };
  const ok = await run(["probe-audio", "/r/audio.m4a"], deps);
  assert.equal(ok.code, 0, ok.line);
  assert.deepEqual(JSON.parse(ok.line), { file: "/r/audio.m4a", sizeBytes: 12_000_000, contentType: "audio/mp4", durationSec: 1501.2, minutes: 26, credits: 3 });
  const video = await run(["probe-audio", "/r/audio.m4a"], { ...deps, exec: async () => ({ stdout: JSON.stringify(FEED) }) });
  assert.equal(video.code, 1);
  assert.match(JSON.parse(video.line).error, /has a video stream/);
  const mp3 = await run(["probe-audio", "/r/audio.mp3"], deps);
  assert.equal(mp3.code, 1);
  assert.match(JSON.parse(mp3.line).error, /m4a, webm/);
  const none = await run(["probe-audio", "/r/audio.m4a"], { ...deps, exec: async () => ({ stdout: JSON.stringify({ streams: [], format: {} }) }) });
  assert.equal(none.code, 1);
  assert.match(JSON.parse(none.line).error, /no audio stream/);
});

test("run probe-audio: credits are 1 for each started 10 minutes, at least 1", async () => {
  const at = async (sec) => {
    const deps = { exec: async () => ({ stdout: JSON.stringify({ streams: [{ codec_type: "audio" }], format: { duration: String(sec) } }) }), stat: async () => ({ size: 1 }), now: () => new Date() };
    const out = JSON.parse((await run(["probe-audio", "/r/a.m4a"], deps)).line);
    return [out.minutes, out.credits];
  };
  assert.deepEqual(await at(5), [1, 1]);
  assert.deepEqual(await at(600), [10, 1]);
  assert.deepEqual(await at(600.5), [11, 2]);
  assert.deepEqual(await at(3600), [60, 6]);
});

test("run put takes a transcribe upload's reply (upload_id) and prints that id, never a URL", async () => {
  const { dir, path } = await tmpFile(Buffer.from("0123456789"));
  try {
    const reply = { upload_id: "u1-m4a", expiresAt: "2026-11-12T12:00:00Z", parts: [{ partNumber: 1, offset: 0, size: 10, url: "https://r2.example/a?X-Amz-Signature=abc" }] };
    const replyPath = join(dir, "reply.json");
    await writeFile(replyPath, JSON.stringify(reply));
    const deps = { exec: async () => assert.fail("no ffprobe"), fetch: async () => ({ status: 200 }), sleep: async () => {}, readFile, stat, now: () => new Date("2026-11-10T12:00:00Z") };
    const ok = await run(["put", path, "--reply", replyPath], deps);
    assert.equal(ok.code, 0, ok.line);
    assert.deepEqual(JSON.parse(ok.line), { ok: true, upload_id: "u1-m4a", parts: 1, bytes: 10 });
    const bad = await run(["put", path, "--reply", replyPath], { ...deps, fetch: async () => ({ status: 403 }) });
    assert.deepEqual(JSON.parse(bad.line), { ok: false, upload_id: "u1-m4a", partNumber: 1, status: 403 });
    await writeFile(replyPath, JSON.stringify({ ...reply, projectId: "p1" }));
    const both = await run(["put", path, "--reply", replyPath], deps);
    assert.equal(both.code, 1);
    assert.match(JSON.parse(both.line).error, /exactly one of projectId and upload_id/);
  } finally {
    await rm(dir, { recursive: true });
  }
});

// ---- a clip's title and hook from <run>/clips.json: on a shell line, `$`, `"` and a backtick belong to the shell

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TITLE = 'I made $100k in "one" week with `this`';
const HOOK = 'The $5 trick: "free" money, `echo now`';

async function runFolder(clips) {
  const dir = await mkdtemp(join(tmpdir(), "boqo post run "));
  await writeFile(join(dir, "clips.json"), JSON.stringify({ clips }));
  return dir;
}

test("run name --run --n takes the clip's title from clips.json; the title rules are the same", async () => {
  const dir = await runFolder([{ n: 1, title: TITLE, hook: HOOK }, { n: 2, title: "The five-minute rule", hook: null }, { n: 3, title: "", hook: null }]);
  try {
    const deps = { readFile };
    assert.deepEqual(JSON.parse((await run(["name", "--run", dir, "--n", "1"], deps)).line), { filename: `${TITLE}.mp4` });
    const cases = [
      [["name", "--run", dir, "--n", "2"], /- or _/],
      [["name", "--run", dir, "--n", "3"], /clip 3 has no title/],
      [["name", "--run", dir, "--n", "9"], /clips\.json has no clip 9/],
      [["name", "--run", dir, "--n", "x"], /--n/],
      [["name", "--run", dir], /--n/],
      [["name", "--run", join(dir, "missing"), "--n", "1"], /cannot read clips\.json/],
    ];
    for (const [args, re] of cases) {
      const { code, line } = await run(args, deps);
      assert.equal(code, 1, args.join(" "));
      assert.match(JSON.parse(line).error, re, args.join(" "));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("run caption --run --n gives the same words as --title and --hook; with no hook, the title alone", async () => {
  const dir = await runFolder([{ n: 1, title: TITLE, hook: HOOK }, { n: 2, title: "Only a title", hook: null }]);
  try {
    const deps = { readFile };
    const fromRun = await run(["caption", "--run", dir, "--n", "1", "--tags", "#clips, gaming"], deps);
    assert.equal(fromRun.code, 0, fromRun.line);
    assert.deepEqual(JSON.parse(fromRun.line), JSON.parse((await run(["caption", "--title", TITLE, "--hook", HOOK, "--tags", "#clips, gaming"], deps)).line));
    assert.equal(JSON.parse(fromRun.line).tiktok.text, `${HOOK}\n\n${TITLE}\n\n#clips #gaming`);
    assert.deepEqual(JSON.parse((await run(["caption", "--run", dir, "--n", "2"], deps)).line).youtube, { title: "Only a title", text: "" });
    for (const args of [["caption", "--run", dir, "--n", "1", "--title", "t"], ["caption", "--run", dir, "--n", "1", "--hook", "h"], ["caption", "--run", dir]]) {
      const { code, line } = await run(args, deps);
      assert.equal(code, 1, args.join(" "));
      assert.ok(JSON.parse(line).error, args.join(" "));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const CLI = fileURLToPath(new URL("../tools/boqo-upload.mjs", import.meta.url));
const sh = (cmd) => spawnSync("sh", ["-c", cmd], { encoding: "utf8" });

test("name and caption through a shell, as post.md writes them: $100k, a \" and a backtick reach the post", { skip: process.platform === "win32" && "needs sh" }, async () => {
  const dir = await runFolder([{ n: 1, title: TITLE, hook: HOOK }]);
  try {
    const name = sh(`"${process.execPath}" "${CLI}" name --run "${dir}" --n 1`);
    assert.equal(name.status, 0, name.stdout + name.stderr);
    assert.deepEqual(JSON.parse(name.stdout), { filename: `${TITLE}.mp4` });
    const caption = sh(`"${process.execPath}" "${CLI}" caption --run "${dir}" --n 1`);
    assert.equal(caption.status, 0, caption.stdout + caption.stderr);
    assert.equal(JSON.parse(caption.stdout).instagram.text, `${HOOK}\n\n${TITLE}`);
    assert.deepEqual(JSON.parse(caption.stdout).youtube, { title: TITLE, text: HOOK });
    // The control: a title in --title's double quotes loses $100k to the shell (`$1` is empty) before the tool runs.
    const old = sh(`"${process.execPath}" "${CLI}" caption --title "I made $100k"`);
    assert.equal(JSON.parse(old.stdout).youtube.title, "I made 00k");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
